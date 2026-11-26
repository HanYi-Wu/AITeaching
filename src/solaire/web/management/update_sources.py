"""Canonical public assets from the project's GitHub releases only."""

from __future__ import annotations

import re

RELEASE_REPO = "HanYi-Wu/AITeaching"
MAX_UPDATE_DOWNLOAD_BYTES = 128 * 1024**2


def github_asset_url(tag: str) -> str:
    if not re.fullmatch(r"v?[0-9]{1,8}(?:\.[0-9]{1,8}){2}", tag):
        raise ValueError("Invalid stable release tag")
    version = tag.removeprefix("v")
    return f"https://github.com/{RELEASE_REPO}/releases/download/{tag}/OriginReach-update-v{version}.zip"


def github_asset_metadata(release: dict, tag: str) -> dict | None:
    url = github_asset_url(tag)
    matches = [asset for asset in (release.get("assets") or []) if isinstance(asset, dict)
               and asset.get("browser_download_url") == url and asset.get("state") == "uploaded"]
    if len(matches) != 1:
        return None
    asset = matches[0]
    size = asset.get("size")
    digest = asset.get("digest")
    if type(size) is not int or not 0 < size <= MAX_UPDATE_DOWNLOAD_BYTES:
        return None
    if digest is not None and (not isinstance(digest, str) or not re.fullmatch(r"sha256:[0-9a-f]{64}", digest)):
        return None
    return {"tag": tag, "size": size, "sha256": digest.removeprefix("sha256:") if digest else None}
