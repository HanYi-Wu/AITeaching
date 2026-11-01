"""Safe graph serialization with optional native YAML acceleration."""
from __future__ import annotations

from typing import Any
import yaml

from solaire.common.yaml_utils import safe_load_yaml as safe_yaml_load

_SAFE_DUMPER = getattr(yaml, "CSafeDumper", yaml.SafeDumper)


def safe_yaml_dump(data: Any) -> str:
    return yaml.dump(data, Dumper=_SAFE_DUMPER, allow_unicode=True, sort_keys=False)
