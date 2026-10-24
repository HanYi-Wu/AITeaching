"""Only remove unchanged, unexported drafts after an export completes."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import yaml

from solaire.web.exam_workspace_service import config_json_path, exam_yaml_path

_RECOVERY_DIGEST = "export_recovery_sha256"


def _document_digest(document: dict) -> str:
    document = dict(document)
    metadata = dict(document.get("metadata") or {})
    metadata.pop(_RECOVERY_DIGEST, None)
    if metadata:
        document["metadata"] = metadata
    else:
        document.pop("metadata", None)
    return hashlib.sha256(
        json.dumps(document, ensure_ascii=False, sort_keys=True, default=str).encode(
            "utf-8"
        )
    ).hexdigest()


def recovery_document(document: dict) -> dict:
    """Keep the original revision when subsequent saves preserve metadata."""
    return {
        **document,
        "metadata": {
            **(document.get("metadata") or {}),
            _RECOVERY_DIGEST: _document_digest(document),
        },
    }


def cleanup_revision(
    root: Path, exam_id: str, *, require_recovery: bool = False
) -> str | None:
    """Return a revision to compare again immediately before automatic deletion.

    Old recovery drafts without a recorded revision are preserved on task retry.
    Explicit cleanup of ordinary drafts remains supported by the legacy API.
    """
    try:
        path = exam_yaml_path(root, exam_id)
        document_bytes = path.read_bytes()
        document = yaml.safe_load(document_bytes)
        if not isinstance(document, dict):
            return None
        config_path = config_json_path(root, exam_id)
        config_bytes = config_path.read_bytes() if config_path.exists() else b"{}"
        config = json.loads(config_bytes)
        if not isinstance(config, dict) or config.get("status", "draft") != "draft":
            return None
        if any(p.suffix.lower() in {".pdf", ".docx"} for p in path.parent.iterdir()):
            return None
        metadata = document.get("metadata") or {}
        digest = metadata.get(_RECOVERY_DIGEST)
        if digest is not None:
            if digest != _document_digest(document):
                return None
        elif require_recovery:
            return None
        return hashlib.sha256(document_bytes + b"\0" + config_bytes).hexdigest()
    except (OSError, ValueError, TypeError, AttributeError, yaml.YAMLError):
        # Unreadable or changed work must never turn an otherwise successful
        # export into destructive cleanup.
        return None
