"""Administrator-only, single-slot inbox for unactivated update packages."""

from __future__ import annotations

import json
import os
import secrets
import shutil
import subprocess
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Annotated

import anyio
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field

from solaire.web.auth_api import current_platform_user
from solaire.web.management.update_discovery import installed_update_version
from solaire.web.management.update_zip import verify_update_zip
from solaire.web.management.update_sources import MAX_UPDATE_DOWNLOAD_BYTES
from solaire.web.recent_projects import app_data_dir
from solaire.web.school_routes.common import _require_admin

router = APIRouter()
MAX_UPLOAD = MAX_UPDATE_DOWNLOAD_BYTES


class UpdateSchedule(BaseModel):
    model_config = ConfigDict(extra="forbid")
    package_id: str = Field(pattern=r"^[0-9a-f]{32}$")
    run_at: AwareDatetime | None = None


class UpdateRollback(BaseModel):
    model_config = ConfigDict(extra="forbid")
    package_id: str = Field(pattern=r"^[0-9a-f]{32}$")


class OnlineUpdateSchedule(BaseModel):
    model_config = ConfigDict(extra="forbid")
    version: str = Field(pattern=r"^[0-9]{1,8}(?:\.[0-9]{1,8}){2}$")
    run_at: AwareDatetime | None = None


def _scheduled_time(value: datetime | None) -> datetime:
    now = datetime.now(timezone.utc)
    run_at = value.astimezone(timezone.utc) if value else now
    if not now <= run_at <= now + timedelta(days=30):
        raise HTTPException(400, "更新时间须在未来 30 天内")
    return run_at


def inbox_root() -> Path:
    return app_data_dir() / "update_inbox"


def verification_key() -> Path | None:
    raw = os.environ.get("EH_UPDATE_PUBLIC_KEY_FILE", "")
    key = Path(raw) if raw else None
    return key if key and key.is_absolute() and key.is_file() else None


def inbox_status() -> dict:
    receipt = inbox_root() / "pending" / "receipt.json"
    try:
        pending = json.loads(receipt.read_text(encoding="utf-8"))
        schedule = receipt.parent / f"schedule-{pending['package_id']}.json"
        try:
            pending.update(json.loads(schedule.read_text(encoding="utf-8")), state="scheduled" if pending.get("source") != "github" else "download_queued")
        except FileNotFoundError:
            pass
        worker = receipt.parent / f"worker-{pending['package_id']}.json"
        try:
            result = json.loads(worker.read_text(encoding="utf-8"))
            pending.update({key: result[key] for key in ("state", "updated_at", "changed_count", "backend_changed", "frontend_changed", "schema_unchanged", "schema_before", "schema_after", "switch_seconds") if key in result})
        except FileNotFoundError:
            pass
        if pending["state"] in {"frontend_applied", "backend_applied"} and (receipt.parent / f"rollback-{pending['package_id']}").exists():
            pending["state"] = "rollback_requested"
        pending.pop("asset", None)
    except FileNotFoundError:
        pending = None
    return {"enabled": verification_key() is not None, "pending": pending}


@router.get("/admin/system/update-package")
def pending_package(user: Annotated[dict, Depends(current_platform_user)]):
    _require_admin(user)
    return inbox_status()


@router.delete("/admin/system/update-package/{package_id}")
def close_update_package(package_id: str, user: Annotated[dict, Depends(current_platform_user)]):
    _require_admin(user)
    root = inbox_root()
    claim = root / "uploading"
    try:
        claim.mkdir(mode=0o700)
    except (FileNotFoundError, FileExistsError):
        raise HTTPException(409, "更新任务已变化，请刷新页面") from None
    try:
        pending = inbox_status()["pending"]
        terminal = {"download_failed", "preflight_failed", "frontend_rolled_back", "frontend_applied", "backend_applied", "backend_rolled_back", "rollback_failed"}
        if not pending or pending["package_id"] != package_id or pending["state"] not in terminal:
            raise HTTPException(409, "当前更新任务尚不能移除")
        id_ = UpdateRollback(package_id=package_id).package_id
        target = root / f"discarded-{id_}"
        history = root / f"closed-{id_}.tmp"
        try:
            history.write_text(json.dumps({**pending, "closed_at": datetime.now(timezone.utc).isoformat()}), encoding="utf-8")
            history.replace(root / "last_closed.json")
        finally:
            history.unlink(missing_ok=True)
        (root / "pending").rename(target)
        shutil.rmtree(target)
    finally:
        claim.rmdir()
    return {"ok": True}


@router.post("/admin/system/update-package/rollback", status_code=202)
def request_rollback(body: UpdateRollback, user: Annotated[dict, Depends(current_platform_user)]):
    _require_admin(user)
    pending = inbox_status()["pending"]
    if not pending or pending["package_id"] != body.package_id or pending["state"] not in {"frontend_applied", "backend_applied"}:
        raise HTTPException(409, "当前没有可回滚的更新")
    marker = inbox_root() / "pending" / f"rollback-{body.package_id}"
    try:
        with marker.open("xb"):
            pass
    except (FileExistsError, FileNotFoundError):
        raise HTTPException(409, "回滚状态已变化，请刷新页面") from None
    return {**pending, "state": "rollback_requested"}


@router.post("/admin/system/update-package/schedule", status_code=202)
def schedule_package(body: UpdateSchedule, user: Annotated[dict, Depends(current_platform_user)]):
    _require_admin(user)
    status = inbox_status()
    if not status["enabled"]:
        raise HTTPException(503, "未配置受信任的更新签名公钥")
    pending = status["pending"]
    if not pending or pending["package_id"] != body.package_id:
        raise HTTPException(409, "待更新包已变更，请刷新页面")
    if pending["state"] != "verified":
        raise HTTPException(409, "此更新已排队")
    run_at = _scheduled_time(body.run_at)
    root = inbox_root()
    command = {"run_at": run_at.isoformat()}
    temporary = root / f"schedule-{secrets.token_hex(16)}.tmp"
    destination = root / "pending" / f"schedule-{body.package_id}.json"
    try:
        with temporary.open("x", encoding="utf-8") as output:
            json.dump(command, output)
            output.flush()
            os.fsync(output.fileno())
        os.link(temporary, destination)
    except (FileExistsError, FileNotFoundError):
        raise HTTPException(409, "更新任务已变化，请刷新页面") from None
    finally:
        temporary.unlink(missing_ok=True)
    return {**pending, **command, "state": "scheduled"}


@router.post("/admin/system/update-package/github", status_code=202)
def schedule_github_update(body: OnlineUpdateSchedule, request: Request, user: Annotated[dict, Depends(current_platform_user)]):
    _require_admin(user)
    if verification_key() is None:
        raise HTTPException(503, "未配置受信任的更新签名公钥")
    discovery = request.app.state.release_discovery
    snapshot = discovery.snapshot()
    asset = discovery.asset
    if (not snapshot.get("online_package_available") or snapshot["latest"] != body.version
            or not asset or asset["tag"].removeprefix("v") != body.version):
        raise HTTPException(409, "当前未发现适用的 GitHub 更新包，请刷新或手动上传")
    run_at = _scheduled_time(body.run_at)
    root = inbox_root()
    root.mkdir(parents=True, mode=0o700, exist_ok=True)
    claimed = root / "uploading"
    try:
        claimed.mkdir(mode=0o700)
    except FileExistsError:
        raise HTTPException(409, "已有更新包正在处理") from None
    published = False
    try:
        pending = root / "pending"
        if pending.exists():
            raise HTTPException(409, "已有更新任务，请先处理当前任务")
        package_id = secrets.token_hex(16)
        receipt = {"package_id": package_id, "version": body.version, "base": snapshot["installed"],
                   "state": "download_queued", "source": "github", "asset": asset,
                   "received_at": datetime.now(timezone.utc).isoformat()}
        command = {"run_at": run_at.isoformat()}
        (claimed / "receipt.json").write_text(json.dumps(receipt), encoding="utf-8")
        (claimed / f"schedule-{package_id}.json").write_text(json.dumps(command), encoding="utf-8")
        claimed.rename(pending)
        published = True
        return {**{key: value for key, value in receipt.items() if key != "asset"}, **command}
    finally:
        if not published:
            shutil.rmtree(claimed)


@router.post("/admin/system/update-package", status_code=201)
async def upload_package(request: Request, user: Annotated[dict, Depends(current_platform_user)]):
    _require_admin(user)
    key = verification_key()
    if key is None:
        raise HTTPException(503, "未配置受信任的更新签名公钥")
    if request.headers.get("content-type", "").split(";", 1)[0].lower() != "application/zip":
        raise HTTPException(415, "请上传签名 ZIP 更新包")
    length = request.headers.get("content-length")
    if length is not None:
        try:
            size = int(length)
        except ValueError:
            raise HTTPException(400, "无效的上传长度") from None
        if not 0 < size <= MAX_UPLOAD:
            raise HTTPException(413, "更新包大小超限")
    root = inbox_root()
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    claimed = root / "uploading"
    pending = root / "pending"
    try:
        claimed.mkdir(mode=0o700)
    except FileExistsError:
        raise HTTPException(409, "另一个更新包正在上传或验证") from None
    published = False
    try:
        if pending.exists():
            raise HTTPException(409, "已有验证通过的更新包等待处理")
        package = claimed / "update.zip"
        total = 0
        try:
            with anyio.fail_after(120):
                async with await anyio.open_file(package, "xb") as output:
                    async for chunk in request.stream():
                        total += len(chunk)
                        if total > MAX_UPLOAD:
                            raise HTTPException(413, "更新包大小超限")
                        await output.write(chunk)
        except TimeoutError:
            raise HTTPException(408, "上传更新包超时") from None
        try:
            manifest = await anyio.to_thread.run_sync(verify_update_zip, package, key, installed_update_version())
        except (ValueError, zipfile.BadZipFile, NotImplementedError, RuntimeError):
            raise HTTPException(422, "更新包格式、签名、版本或内容校验失败") from None
        except (OSError, subprocess.TimeoutExpired):
            raise HTTPException(503, "更新校验服务不可用") from None
        receipt = {"package_id": secrets.token_hex(16), "version": manifest["version"], "base": manifest["base"],
                   "file_count": len(manifest["files"]) + len(manifest.get("deletions", {})),
                   "received_at": datetime.now(timezone.utc).isoformat(), "state": "verified"}
        (claimed / "receipt.json").write_text(json.dumps(receipt), encoding="utf-8")
        claimed.rename(pending)
        published = True
        return receipt
    finally:
        if not published:
            shutil.rmtree(claimed)
