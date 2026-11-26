"""Release metadata only: never download or execute code in the web process."""

from __future__ import annotations

import asyncio
import json
import os
import re
from datetime import datetime, timezone
from typing import Annotated
from pathlib import Path

import httpx
from fastapi import APIRouter, Depends, Request

from solaire.exam_compiler import __version__
from solaire.web.auth_api import current_platform_user
from solaire.web.frontend_release import read_frontend_release
from solaire.web.management.update_sources import RELEASE_REPO, github_asset_metadata
from solaire.web.school_routes.common import _require_admin

router = APIRouter()
RELEASE_API = f"https://api.github.com/repos/{RELEASE_REPO}/releases/latest"


def installed_update_version() -> str:
    configured = os.environ.get("EH_FRONTEND_RELEASE_STORE", "")
    frontend = read_frontend_release(Path(configured)) if configured else None
    if frontend:
        try:
            return max(frontend[2], __version__, key=lambda version: tuple(map(int, version.split("."))))
        except ValueError:
            return __version__
    return __version__


class ReleaseDiscovery:
    def __init__(self):
        self.enabled = os.environ.get("EH_UPDATE_CHECK_ENABLED", "1") == "1"
        self.status = "pending" if self.enabled else "disabled"
        self.latest = None
        self.checked_at = None
        self.etag = None
        self.asset = None

    def snapshot(self):
        installed = installed_update_version()
        status = self.status
        if self.latest and status in {"available", "current"}:
            status = "available" if tuple(map(int, self.latest.split("."))) > tuple(map(int, installed.split("."))) else "current"
        return dict(status=status, installed=installed, latest=self.latest,
                    checked_at=self.checked_at, online_package_available=bool(status == "available" and self.asset))

    async def check(self):
        headers = {"Accept": "application/vnd.github+json"}
        if self.etag:
            headers["If-None-Match"] = self.etag
        try:
            async with asyncio.timeout(10):
                async with httpx.AsyncClient(timeout=5, follow_redirects=False, trust_env=False,
                                             proxy=os.environ.get("EH_UPDATE_PROXY_URL") or None) as client:
                    async with client.stream("GET", RELEASE_API, headers=headers) as response:
                        if response.status_code != 304:
                            response.raise_for_status()
                            body = bytearray()
                            async for chunk in response.aiter_bytes():
                                body.extend(chunk)
                                if len(body) > 512_000:
                                    raise ValueError("metadata too large")
                            release = json.loads(body)
                            tag = release["tag_name"]
                            if not re.fullmatch(r"v?[0-9]{1,8}(\.[0-9]{1,8}){2}", tag):
                                raise ValueError("invalid stable tag")
                            asset = github_asset_metadata(release, tag)
                            self.latest = tag.removeprefix("v")
                            self.asset = asset
                            self.etag = response.headers.get("ETag")
            if self.latest is None:
                raise ValueError("missing cached metadata")
            version = lambda value: tuple(map(int, value.split(".")))
            self.status = "available" if version(self.latest) > version(installed_update_version()) else "current"
        except (TimeoutError, httpx.HTTPError, ValueError, TypeError, KeyError):
            self.status = "unreachable"
        self.checked_at = datetime.now(timezone.utc).isoformat()

    async def run(self):
        while self.enabled:
            await self.check()
            await asyncio.sleep(86400)


@router.get("/admin/system/updates")
def read_updates(request: Request, user: Annotated[dict, Depends(current_platform_user)]):
    _require_admin(user)
    return request.app.state.release_discovery.snapshot()
