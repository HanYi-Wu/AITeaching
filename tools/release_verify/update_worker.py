"""Preflight scheduled updates and optionally publish frontend-only releases."""

from __future__ import annotations

import argparse
import json
import os
import re
import tempfile
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path

from solaire.web.frontend_release import read_frontend_release
from solaire.web.backend_release import backend_slot
from .backend_slot_runner import slot_configuration
from .backend_activation import rollback_backend
from .backend_slots import BackendDraining, BackendSlots
from .frontend_activation import activate_frontend, prepare_frontend, rollback_frontend
from .update_database import rehearse_platform_migration
from .update_download import download_github_update
from .update_smoke import checked_candidate


@contextmanager
def _worker_lock(root: Path):
    # OS locks are released on process exit, including after a crash.
    with (root / "worker.lock").open("a+b") as handle:
        if os.name == "nt":
            import msvcrt

            def acquire():
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl

            def acquire():
                fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        try:
            acquire()
        except OSError:
            yield False
        else:
            yield True


def _read(path: Path) -> dict:
    with path.open("rb") as source:
        raw = source.read(16_385)
    if len(raw) > 16_384:
        raise ValueError("Invalid update job metadata")
    value = json.loads(raw)
    if not isinstance(value, dict):
        raise ValueError("Invalid update job metadata")
    return value


def _status(pending: Path, package_id: str, state: str, **fields):
    data = {"state": state, "updated_at": datetime.now(timezone.utc).isoformat(), **fields}
    with tempfile.NamedTemporaryFile(dir=pending, suffix=".tmp", delete=False) as output:
        temporary = Path(output.name)
        try:
            output.write(json.dumps(data).encode())
            output.flush()
            os.fsync(output.fileno())
            output.close()
            temporary.replace(pending / f"worker-{package_id}.json")
        finally:
            output.close()
            temporary.unlink(missing_ok=True)


def run_due_preflight(inbox: Path, public_key: Path, installed_version: str, active_release: Path,
                      staging_parent: Path, python: Path, *, now: datetime | None = None,
                      frontend_store: Path | None = None, platform_db: Path | None = None,
                      backend_slots: BackendSlots | None = None) -> str:
    if not inbox.is_dir():
        return "idle"
    with _worker_lock(inbox) as acquired:
        if not acquired:
            return "busy"
        pending = inbox / "pending"
        try:
            receipt = _read(pending / "receipt.json")
            package_id = receipt["package_id"]
            if not isinstance(package_id, str) or not re.fullmatch(r"[0-9a-f]{32}", package_id):
                raise ValueError("Invalid update package identity")
            schedule = _read(pending / f"schedule-{package_id}.json")
        except FileNotFoundError:
            return "idle"
        due = datetime.fromisoformat(schedule["run_at"])
        if due.utcoffset() is None:
            raise ValueError("Update schedule is missing a timezone")
        if due > (now or datetime.now(timezone.utc)):
            return "waiting"
        worker_status = pending / f"worker-{package_id}.json"
        previous = _read(worker_status) if worker_status.is_file() else {}
        if previous.get("state") == "waiting_for_drain" and datetime.fromisoformat(previous["retry_at"]) > (now or datetime.now(timezone.utc)):
            return "waiting_for_drain"
        shared_store = bool(backend_slots and frontend_store and frontend_store.resolve() == backend_slots.store.resolve())
        if previous.get("state") == "backend_applied" and backend_slots and (pending / f"rollback-{package_id}").is_file():
            try:
                rollback_backend(backend_slots.store, package_id=package_id, primary_port=backend_slots.primary_port,
                                 standby_port=backend_slots.standby_port, gateway_port=backend_slots.gateway_port)
            except Exception:
                _status(pending, package_id, "rollback_failed", backend_changed=True)
                raise
            _status(pending, package_id, "backend_rolled_back", backend_changed=True)
            return "backend_rolled_back"
        if previous.get("state") == "frontend_applied" and frontend_store and (pending / f"rollback-{package_id}").is_file():
            try:
                rollback_frontend(frontend_store, package_id)
            except ValueError:
                _status(pending, package_id, "rollback_failed", backend_changed=False)
                raise
            _status(pending, package_id, "frontend_rolled_back", backend_changed=False)
            return "frontend_rolled_back"
        if previous.get("state") in {"download_failed", "preflight_failed", "frontend_applied", "frontend_rolled_back", "rollback_failed", "backend_applied", "backend_rolled_back"}:
            return "already_checked"
        if (previous.get("state") == "preflight_passed"
                and (frontend_store is None or previous.get("backend_changed") or not previous.get("changed_count"))
                and (not (platform_db and previous.get("backend_changed")) or "schema_unchanged" in previous)
                and not (backend_slots and previous.get("backend_changed") and previous.get("schema_unchanged") is True
                         and (previous.get("frontend_changed") is False or shared_store))):
            return "already_checked"
        frontend = read_frontend_release(frontend_store) if frontend_store else None
        live_backend = slot_configuration(backend_slots.store, backend_slot(backend_slots.store)) if backend_slots else None
        if live_backend and live_backend[0].name == package_id and live_backend[2] == receipt["version"]:
            _status(pending, package_id, "backend_applied", backend_changed=True,
                    frontend_changed=bool(frontend and frontend[1] == package_id))
            return "backend_applied"
        if frontend and frontend[1:] == (package_id, receipt["version"]):
            _status(pending, package_id, "frontend_applied", backend_changed=False)
            return "frontend_applied"
        backend_version = live_backend[2] if live_backend else installed_version
        base = max((backend_version, frontend[2]) if frontend else (backend_version,), key=lambda value: tuple(map(int, value.split("."))))
        kwargs = {"frontend_source": frontend[0], "active_backend_version": backend_version} if frontend else {}
        if live_backend:
            kwargs.update(backend_source=live_backend[0], active_backend_version=backend_version)
        package = pending / "update.zip"
        if receipt.get("source") == "github" and not package.is_file():
            _status(pending, package_id, "downloading")
            try:
                if base != receipt["base"]:
                    raise ValueError("Installed version changed after scheduling")
                download_github_update(receipt["asset"], package, receipt["version"])
            except Exception:
                _status(pending, package_id, "download_failed")
                raise
        _status(pending, package_id, "preflighting")
        try:
            with checked_candidate(package, public_key, base,
                                   active_release, staging_parent, python, **kwargs) as (candidate, manifest, changed):
                if manifest["version"] != receipt["version"] or manifest["base"] != receipt["base"]:
                    raise ValueError("Receipt does not match signed package")
                backend_changed = any(path.startswith("src/") for path in changed)
                frontend_changed = any(path.startswith("web/dist/") for path in changed)
                database = rehearse_platform_migration(candidate, python, platform_db) if backend_changed and platform_db else {}
                if frontend_store is not None and changed and not backend_changed:
                    activate_frontend(candidate, frontend[0] if frontend else active_release / "web" / "dist",
                                      frontend_store, package_id, manifest["version"], changed)
                    _status(pending, package_id, "frontend_applied", changed_count=len(changed), backend_changed=False)
                    return "frontend_applied"
                if backend_slots and backend_changed and database.get("schema_unchanged") is True and (not frontend_changed or shared_store):
                    prepared = None
                    if frontend_changed:
                        def prepared():
                            return prepare_frontend(candidate, frontend[0] if frontend else active_release / "web" / "dist",
                                                    backend_slots.store, package_id, manifest["version"],
                                                    tuple(name for name in changed if name.startswith("web/dist/")))
                    switch_seconds = backend_slots.publish(candidate, package_id, manifest["version"], schema_unchanged=True,
                                                          previous_version=backend_version,
                                                          **({"frontend": prepared} if prepared else {}))
                    _status(pending, package_id, "backend_applied", changed_count=len(changed), backend_changed=True,
                            frontend_changed=frontend_changed, switch_seconds=round(switch_seconds, 3), **database)
                    return "backend_applied"
                _status(pending, package_id, "preflight_passed", changed_count=len(changed),
                        backend_changed=backend_changed, frontend_changed=frontend_changed, **database)
        except BackendDraining:
            _status(pending, package_id, "waiting_for_drain", backend_changed=True,
                    retry_at=((now or datetime.now(timezone.utc)) + timedelta(seconds=60)).isoformat())
            return "waiting_for_drain"
        except Exception:
            published = read_frontend_release(frontend_store) if frontend_store else None
            active_slot = slot_configuration(backend_slots.store, backend_slot(backend_slots.store)) if backend_slots else None
            backend_was_published = active_slot and active_slot[0].name == package_id and active_slot[2] == receipt["version"]
            if not backend_was_published and (not published or published[1:] != (package_id, receipt["version"])):
                _status(pending, package_id, "preflight_failed")
            raise
        return "preflight_passed"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    for option in ("inbox", "public-key", "active-release", "staging-parent", "python"):
        parser.add_argument(f"--{option}", type=Path, required=True)
    parser.add_argument("--installed-version", required=True)
    parser.add_argument("--frontend-store", type=Path)
    parser.add_argument("--platform-db", type=Path, help="Take a read-only snapshot for backend migration rehearsal")
    parser.add_argument("--enable-compatible-backend-rollout", type=Path, metavar="SLOT_STORE",
                        help="Opt in after configuring both systemd user slots and certifying rollback-compatible backend packages")
    parser.add_argument("--primary-port", type=int, default=8000)
    parser.add_argument("--standby-port", type=int, default=8001)
    parser.add_argument("--gateway-port", type=int, default=8080)
    args = parser.parse_args()
    if hasattr(os, "geteuid") and os.geteuid() == 0:
        parser.error("Run the candidate worker as a dedicated non-root service account")
    options = vars(args)
    slot_store = options.pop("enable_compatible_backend_rollout")
    ports = [options.pop(name) for name in ("primary_port", "standby_port", "gateway_port")]
    if slot_store and not args.platform_db:
        parser.error("Backend activation requires --platform-db")
    print(run_due_preflight(**options, backend_slots=BackendSlots(slot_store, *ports) if slot_store else None), flush=True)


if __name__ == "__main__":
    main()
