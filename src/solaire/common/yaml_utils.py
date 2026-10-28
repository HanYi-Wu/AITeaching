"""Safe YAML loading helpers."""

from __future__ import annotations

from typing import Any

import yaml


_SAFE_LOADER = getattr(yaml, "CSafeLoader", yaml.SafeLoader)


def safe_load_yaml(stream: Any) -> Any:
    """Load YAML with safe constructors, using LibYAML when it is available."""
    return yaml.load(stream, Loader=_SAFE_LOADER)
