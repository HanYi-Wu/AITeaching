"""Unified write plan data structures."""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class WritePlan:
    """Unified mutation plan for bulk imports and resource writes."""

    project_root: Path
    target_library: Path
    yaml_writes: dict[Path, str] = field(default_factory=dict)
    extra_writes: dict[Path, bytes] = field(default_factory=dict)
    written_count: int = 0
    warnings: list[str] = field(default_factory=list)

    @property
    def affected_paths(self) -> set[Path]:
        return set(self.yaml_writes.keys()) | set(self.extra_writes.keys())
