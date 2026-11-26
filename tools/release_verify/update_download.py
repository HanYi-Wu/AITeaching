"""Download only the scheduled GitHub release asset, within a hard deadline."""

from __future__ import annotations

import asyncio
import hashlib
import os
import re
import tempfile
from pathlib import Path
from urllib.parse import urljoin, urlsplit

import httpx

from solaire.web.management.update_sources import MAX_UPDATE_DOWNLOAD_BYTES, github_asset_url


def _redirect(url: str, location: str, canonical: str) -> str:
    destination = urljoin(url, location)
    parts = urlsplit(destination)
    if destination == canonical:
        return destination
    if (parts.scheme != "https" or parts.netloc not in {"release-assets.githubusercontent.com", "objects.githubusercontent.com"}
            or not parts.path or parts.fragment):
        raise ValueError("GitHub returned an unapproved download redirect")
    return destination


async def _download(asset: dict, destination: Path, version: str) -> None:
    tag, size, expected = asset["tag"], asset["size"], asset.get("sha256")
    canonical = github_asset_url(tag)
    if tag.removeprefix("v") != version or type(size) is not int or not 0 < size <= MAX_UPDATE_DOWNLOAD_BYTES:
        raise ValueError("Update release metadata changed")
    if expected is not None and not re.fullmatch(r"[0-9a-f]{64}", expected):
        raise ValueError("Invalid download digest")
    url = canonical
    proxy = os.environ.get("EH_UPDATE_PROXY_URL") or None
    async with asyncio.timeout(90), httpx.AsyncClient(timeout=10, follow_redirects=False, trust_env=False, proxy=proxy) as client:
        for _ in range(4):
            async with client.stream("GET", url, headers={"Accept-Encoding": "identity"}) as response:
                if response.status_code in {301, 302, 303, 307, 308}:
                    url = _redirect(url, response.headers["Location"], canonical)
                    continue
                response.raise_for_status()
                if response.status_code != 200:
                    raise ValueError("Unexpected update response")
                digest = hashlib.sha256()
                received = 0
                with tempfile.NamedTemporaryFile(dir=destination.parent, suffix=".part", delete=False) as output:
                    temporary = Path(output.name)
                    try:
                        async for chunk in response.aiter_raw():
                            received += len(chunk)
                            if received > size:
                                raise ValueError("Download exceeds the release size")
                            output.write(chunk)
                            digest.update(chunk)
                        if received != size or (expected and digest.hexdigest() != expected):
                            raise ValueError("Downloaded package does not match the release metadata")
                        output.flush()
                        os.fsync(output.fileno())
                        output.close()
                        temporary.replace(destination)
                    finally:
                        output.close()
                        temporary.unlink(missing_ok=True)
                return
        raise ValueError("Too many update redirects")


def download_github_update(asset: dict, destination: Path, version: str) -> None:
    asyncio.run(_download(asset, destination, version))
