"""Select only an operator-configured backend slot, never a URL from a package."""

from __future__ import annotations

import json
from pathlib import Path

from .frontend_release import _read_pointer


def backend_slot(store: Path) -> str:
    published = _read_pointer(store).get("backend_slot")
    if published in ("primary", "standby"):
        return published
    try:
        with (store / "backend.json").open("rb") as source:
            raw = source.read(1025)
        if len(raw) > 1024:
            return "primary"
        value = json.loads(raw)
        slot = value.get("slot") if isinstance(value, dict) else None
        return slot if slot in ("primary", "standby") else "primary"
    except (OSError, ValueError):
        return "primary"
