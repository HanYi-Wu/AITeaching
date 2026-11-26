"""Read the atomically published frontend pointer from a trusted release store."""

from __future__ import annotations

import json
import re
from pathlib import Path


def _read_pointer(store: Path) -> dict:
    try:
        with (store / "current.json").open("rb") as source:
            raw = source.read(2049)
        if len(raw) > 2048:
            return {}
        data = json.loads(raw)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def _release_entry(store: Path, data: dict) -> tuple[Path, str, str] | None:
    try:
        identity, version = data["package_id"], data["version"]
        if not re.fullmatch(r"[0-9a-f]{32}", identity) or not re.fullmatch(r"[0-9]{1,8}(?:\.[0-9]{1,8}){2}", version):
            return None
        root = store.resolve()
        published = root / identity
        if published.resolve() != published or not (published / "index.html").is_file():
            return None
        return published, identity, version
    except (OSError, ValueError, KeyError, TypeError):
        return None


def frontend_snapshot(store: Path):
    """Read current and compatibility roots from the same pointer generation."""
    data = _read_pointer(store)
    fallback = data.get("compatibility")
    return _release_entry(store, data), _release_entry(store, fallback) if isinstance(fallback, dict) else None


def read_frontend_release(store: Path) -> tuple[Path, str, str] | None:
    return frontend_snapshot(store)[0]
