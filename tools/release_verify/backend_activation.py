"""Health-gated backend cutover between preconfigured loopback services."""

from __future__ import annotations

import json
import time
from pathlib import Path
from urllib.request import ProxyHandler, Request, build_opener

from solaire.web.backend_release import backend_slot
from solaire.web.frontend_release import _read_pointer, _release_entry
from .frontend_activation import _write_pointer
from .update_smoke import _NoRedirect


def _set_slot(store: Path, slot: str) -> None:
    _write_pointer(store, {**_read_pointer(store), "backend_slot": slot})


def _check_frontend(port: int, release: tuple[Path, str, str], deadline: float) -> None:
    timeout = min(3, deadline - time.monotonic())
    if timeout <= 0:
        raise TimeoutError("Frontend verification deadline expired")
    url = f"http://127.0.0.1:{port}/_eh_release"
    with build_opener(ProxyHandler({}), _NoRedirect()).open(url, timeout=timeout) as response:
        info = json.loads(response.read(2049))
    if (info.get("frontend_release_id"), info.get("frontend_version")) != release[1:]:
        raise ValueError("Frontend gateway did not publish the expected release")


def _check_api(port: int, version: str, deadline: float) -> None:
    if not 1 <= port <= 65535:
        raise ValueError("Invalid loopback port")
    opener = build_opener(ProxyHandler({}), _NoRedirect())
    timeout = min(3, deadline - time.monotonic())
    if timeout <= 0:
        raise TimeoutError("Backend switch health deadline expired")
    request = Request(f"http://127.0.0.1:{port}/api/health", headers={"Cache-Control": "no-store"})
    with opener.open(request, timeout=timeout) as response:
        value = json.loads(response.read(2049))
    if value.get("status") != "ok" or value.get("version") != version:
        raise ValueError("Backend health or version does not match the candidate")


def activate_backend(store: Path, *, expected_slot: str, next_slot: str, next_version: str,
                     next_port: int, gateway_port: int, schema_unchanged: bool,
                     frontend: dict | None = None, previous_version: str | None = None,
                     package_id: str | None = None) -> float:
    """Switch new requests only, leaving both processes alive for drain/rollback.

    The caller owns the update lock and ensures both slots are running and
    application/data compatibility has been approved independently of schema.
    """
    store = store.resolve(strict=True)
    if not schema_unchanged:
        raise ValueError("Backend changes to the database require a maintenance window")
    if {expected_slot, next_slot} != {"primary", "standby"} or backend_slot(store) != expected_slot:
        raise ValueError("Backend slot changed before activation")
    if next_port == gateway_port:
        raise ValueError("Candidate and gateway must have distinct ports")
    frontend_release = _release_entry(store, frontend) if frontend else None
    if frontend is not None and (frontend_release is None or frontend_release[2] != next_version):
        raise ValueError("Prepared frontend release is missing or does not match the backend")
    _check_api(next_port, next_version, time.monotonic() + 10)
    if backend_slot(store) != expected_slot:
        raise ValueError("Backend slot changed during the health gate")
    before = _read_pointer(store)
    rollback = {"package_id": package_id, "slot": expected_slot, "version": previous_version,
                "frontend": {key: before[key] for key in ("package_id", "version", "previous", "compatibility") if key in before},
                "combined": frontend is not None} if previous_version and package_id else None
    started = time.monotonic()
    _write_pointer(store, {**before, **(frontend or {}), "backend_slot": next_slot, "backend_rollback": rollback})
    try:
        _check_api(gateway_port, next_version, started + 15)
        if frontend_release:
            _check_frontend(gateway_port, frontend_release, started + 15)
    except Exception:
        fallback = {"compatibility": {"package_id": frontend_release[1], "version": frontend_release[2]}} if frontend_release else {}
        _write_pointer(store, {**before, **fallback, "backend_slot": expected_slot})
        raise
    return time.monotonic() - started


def rollback_backend(store: Path, *, package_id: str, primary_port: int, standby_port: int, gateway_port: int) -> None:
    store = store.resolve(strict=True)
    before = _read_pointer(store)
    if before.get("backend_restored_from") == package_id:
        return
    plan = before.get("backend_rollback")
    if not isinstance(plan, dict) or plan.get("package_id") != package_id:
        raise ValueError("Backend rollback target is no longer available")
    previous, version = plan.get("slot"), plan.get("version")
    if previous not in ("primary", "standby") or previous == backend_slot(store) or not isinstance(version, str):
        raise ValueError("Invalid previous backend slot")
    _check_api(primary_port if previous == "primary" else standby_port, version, time.monotonic() + 10)
    retained = {**before, "backend_slot": previous, "backend_rollback": None, "backend_restored_from": package_id}
    old_frontend = None
    if plan.get("combined"):
        current_frontend = _release_entry(store, before)
        previous_frontend = plan["frontend"]
        old_frontend = _release_entry(store, previous_frontend)
        if previous_frontend.get("package_id") and old_frontend is None:
            raise ValueError("Previous frontend release is unavailable")
        for key in ("package_id", "version", "previous", "compatibility"):
            retained.pop(key, None)
        retained.update(previous_frontend)
        if current_frontend:
            retained["compatibility"] = {"package_id": current_frontend[1], "version": current_frontend[2]}
    _write_pointer(store, retained)
    try:
        end = time.monotonic() + 15
        _check_api(gateway_port, version, end)
        if old_frontend:
            _check_frontend(gateway_port, old_frontend, end)
    except Exception:
        _write_pointer(store, before)
        raise
