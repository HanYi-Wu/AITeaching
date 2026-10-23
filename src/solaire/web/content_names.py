"""Allocate readable names without replacing existing teaching content."""

from __future__ import annotations

import re
from collections.abc import Iterable


def available_name(name: str, existing: Iterable[str], *, max_length: int = 120) -> str:
    taken = {value.casefold() for value in existing}
    if name.casefold() not in taken:
        return name
    match = re.fullmatch(r"(.+) \(([0-9]+)\)", name)
    base = match[1] if match else name
    number = max(2, int(match[2]) + 1) if match else 2
    while True:
        suffix = f" ({number})"
        candidate = base[: max_length - len(suffix)].rstrip() + suffix
        if candidate.casefold() not in taken:
            return candidate
        number += 1
