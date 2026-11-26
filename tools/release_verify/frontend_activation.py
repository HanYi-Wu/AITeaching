"""Publish a verified frontend candidate without restarting the web or API process."""

import json
import os
import re
import shutil
import tempfile
from pathlib import Path

from solaire.web.frontend_release import _read_pointer, _release_entry, read_frontend_release


def _write_pointer(store: Path, value: dict) -> None:
    with tempfile.TemporaryDirectory(dir=store, prefix=".pointer-") as temp:
        pointer = Path(temp) / "current.json"
        with pointer.open("x", encoding="utf-8") as handle:
            json.dump(value, handle)
            handle.flush()
            os.fsync(handle.fileno())
        pointer.replace(store / "current.json")


def rollback_frontend(store: Path, expected_package_id: str) -> None:
    """Restore the prior index, keeping immutable assets used by newer open tabs."""
    store = store.resolve(strict=True)
    pointer = _read_pointer(store)
    current = _release_entry(store, pointer)
    compatibility = pointer.get("compatibility")
    restored_from = _release_entry(store, compatibility) if isinstance(compatibility, dict) else None
    if restored_from and restored_from[1] == expected_package_id and "previous" not in pointer:
        return
    if not current or current[1] != expected_package_id or "previous" not in pointer:
        raise ValueError("Frontend rollout changed or has no rollback target")
    previous = pointer["previous"]
    if previous is not None and (not isinstance(previous, dict) or not _release_entry(store, previous)):
        raise ValueError("Previous frontend release is unavailable")
    preserved = {key: value for key, value in pointer.items() if key not in {"package_id", "version", "previous", "compatibility"}}
    _write_pointer(store, {**preserved, **(previous or {}), "compatibility": {"package_id": current[1], "version": current[2]}})


def prepare_frontend(candidate: Path, active_assets: Path, store: Path, package_id: str,
                     version: str, changed: tuple[str, ...]) -> dict:
    if not re.fullmatch(r"[0-9a-f]{32}", package_id) or not re.fullmatch(r"[0-9]{1,8}(?:\.[0-9]{1,8}){2}", version):
        raise ValueError("Invalid frontend release identity")
    if not changed or any(not path.startswith("web/dist/") for path in changed):
        raise ValueError("Only a changed frontend-only update may be activated here")
    for name in changed:
        relative = name.removeprefix("web/dist/")
        if relative.startswith("assets/") and re.search(r"-[\w-]{8,}\.", Path(relative).name) and (active_assets / relative).exists():
            raise ValueError("Update attempts to replace an immutable asset URL")

    store = store.resolve(strict=True)
    target = store / package_id
    existing = read_frontend_release(store)
    with tempfile.TemporaryDirectory(dir=store, prefix=".publishing-") as temp:
        temporary = Path(temp)
        shutil.copytree(candidate / "web" / "dist", temporary / "assets")
        (temporary / "assets").rename(target)
        previous = {"package_id": existing[1], "version": existing[2]} if existing else None
        return {"package_id": package_id, "version": version, "previous": previous}


def activate_frontend(candidate: Path, active_assets: Path, store: Path, package_id: str,
                      version: str, changed: tuple[str, ...]) -> None:
    existing = read_frontend_release(store)
    if existing and existing[1:] == (package_id, version):
        return
    metadata = prepare_frontend(candidate, active_assets, store, package_id, version, changed)
    # Preserve a backend slot when the operator shares the release store.
    _write_pointer(store, {**_read_pointer(store), **metadata})
