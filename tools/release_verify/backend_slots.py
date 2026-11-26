"""Provision the inactive backend slot from the verified candidate source tree."""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import tempfile
import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from urllib.request import ProxyHandler, Request, build_opener

from solaire.web.backend_release import backend_slot
from .backend_activation import _check_api, activate_backend
from .update_smoke import _NoRedirect


class BackendDraining(ValueError):
    pass


def drain_confirmed(port: int, active: str, retiring: str) -> bool:
    token = os.environ.get("EH_UPDATE_DRAIN_TOKEN", "")
    if not token or not token.isascii():
        return False
    request = Request(f"http://127.0.0.1:{port}/_eh_backend_drain", headers={"X-EH-Drain-Token": token})
    try:
        with build_opener(ProxyHandler({}), _NoRedirect()).open(request, timeout=3) as response:
            state = json.loads(response.read(1025))
        count = state["inflight"][retiring]
        return state["active_slot"] == active and type(count) is int and count == 0
    except (OSError, ValueError, TypeError, KeyError):
        return False


def _unit(slot: str) -> str:
    if slot not in {"primary", "standby"}:
        raise ValueError("Unknown backend slot")
    return f"educationhelper-backend@{slot}.service"


def _systemctl(command: str, slot: str, *, check: bool = True):
    return subprocess.run(["systemctl", "--user", command, _unit(slot)],
                          capture_output=True, text=True, timeout=12, check=check)


@dataclass(frozen=True)
class BackendSlots:
    store: Path
    primary_port: int
    standby_port: int
    gateway_port: int

    def publish(self, candidate: Path, package_id: str, version: str, *, schema_unchanged: bool,
                frontend: dict | Callable[[], dict] | None = None, previous_version: str | None = None) -> float:
        if not schema_unchanged:
            raise ValueError("Database structure changed; use a maintenance window")
        if not re.fullmatch(r"[0-9a-f]{32}", package_id) or not re.fullmatch(r"[0-9]{1,8}(?:\.[0-9]{1,8}){2}", version):
            raise ValueError("Invalid backend release identity")
        ports = {self.primary_port, self.standby_port, self.gateway_port}
        if len(ports) != 3 or any(not 1 <= port <= 65535 for port in ports):
            raise ValueError("Backend and gateway require three distinct local ports")
        store = self.store.resolve(strict=True)
        active = backend_slot(store)
        next_slot = "standby" if active == "primary" else "primary"
        next_port = self.standby_port if next_slot == "standby" else self.primary_port
        inactive = _systemctl("is-active", next_slot, check=False)
        state = inactive.stdout.strip()
        if state not in {"inactive", "failed"}:
            if state != "active" or not drain_confirmed(self.gateway_port, active, next_slot) or backend_slot(store) != active:
                raise BackendDraining("Inactive slot is still serving or draining; it was not restarted")
            _systemctl("stop", next_slot)
        frontend = frontend() if callable(frontend) else frontend
        releases = store / "backend-releases"
        releases.mkdir(mode=0o700, exist_ok=True)
        target = releases / package_id
        with tempfile.TemporaryDirectory(dir=releases, prefix=".source-") as temporary:
            staged = Path(temporary) / "release"
            shutil.copytree(candidate / "src", staged / "src")
            staged.rename(target)
        with tempfile.TemporaryDirectory(dir=store, prefix=".slot-") as temporary:
            pointer = Path(temporary) / "slot.json"
            with pointer.open("x", encoding="utf-8") as output:
                json.dump({"package_id": package_id, "port": next_port, "version": version}, output)
                output.flush()
                os.fsync(output.fileno())
            pointer.replace(store / f"slot-{next_slot}.json")
        try:
            _systemctl("start", next_slot)
            deadline = time.monotonic() + 20
            while True:
                try:
                    _check_api(next_port, version, deadline)
                    break
                except OSError:
                    if time.monotonic() >= deadline:
                        raise
                    time.sleep(0.2)
            return activate_backend(store, expected_slot=active, next_slot=next_slot, next_version=version,
                                    next_port=next_port, gateway_port=self.gateway_port, schema_unchanged=True,
                                    frontend=frontend, previous_version=previous_version, package_id=package_id)
        except Exception:
            # Do not stop a process that might still own traffic if restoring
            # the gateway pointer itself failed.
            if backend_slot(store) == active:
                _systemctl("stop", next_slot, check=False)
            raise
