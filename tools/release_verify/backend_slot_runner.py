"""Launch a fixed local service slot using the provisioned runtime and source."""

from __future__ import annotations

import argparse
import json
import os
import re
from pathlib import Path


def slot_configuration(store: Path, slot: str) -> tuple[Path, int, str] | None:
    if slot not in {"primary", "standby"}:
        raise ValueError("Unknown backend slot")
    store = store.resolve(strict=True)
    try:
        with (store / f"slot-{slot}.json").open("rb") as source:
            data = json.loads(source.read(1025))
    except FileNotFoundError:
        return None
    package, port, version = data["package_id"], data["port"], data["version"]
    if not re.fullmatch(r"[0-9a-f]{32}", package) or type(port) is not int or not 1 <= port <= 65535:
        raise ValueError("Invalid backend slot configuration")
    if not re.fullmatch(r"[0-9]{1,8}(?:\.[0-9]{1,8}){2}", version):
        raise ValueError("Invalid backend version")
    release = store / "backend-releases" / package
    if release.resolve(strict=True) != release or not (release / "src" / "solaire" / "web" / "app.py").is_file():
        raise ValueError("Backend slot source is outside its trusted store or missing")
    return release, port, version


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--slot", choices=("primary", "standby"), required=True)
    parser.add_argument("--store", type=Path, required=True)
    parser.add_argument("--runtime-python", type=Path, required=True)
    parser.add_argument("--initial-release", type=Path)
    parser.add_argument("--primary-port", type=int, default=8000)
    args = parser.parse_args()
    settings = slot_configuration(args.store, args.slot)
    if settings is not None:
        release, port, _ = settings
    elif args.slot == "primary" and args.initial_release and 1 <= args.primary_port <= 65535:
        release, port = args.initial_release.resolve(strict=True), args.primary_port
    else:
        parser.error("Backend slot has no verified source")
    executable = str(args.runtime_python.resolve(strict=True))
    os.chdir(release)
    os.execv(executable, [executable, "-IB", "-m", "uvicorn", "solaire.web.app:app",
                         "--app-dir", str(release / "src"), "--host", "127.0.0.1", "--port", str(port),
                         "--timeout-graceful-shutdown", "12"])


if __name__ == "__main__":
    main()
