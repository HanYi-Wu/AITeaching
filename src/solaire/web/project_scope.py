"""Stable browser storage scope without exposing the server's directory path."""

import hashlib
import os
import uuid
from pathlib import Path

from solaire.web.export_lock import FileLease
from solaire.web.security import assert_within_project


def project_scope_id(root: Path) -> str:
    root = root.resolve()
    path = root / ".solaire" / "project-id"
    lock_path = path.with_suffix(".lock")
    assert_within_project(root, path)
    assert_within_project(root, lock_path)
    with FileLease(lock_path, timeout=5):
        try:
            identity = uuid.UUID(path.read_text(encoding="ascii").strip()).hex
        except (FileNotFoundError, ValueError):
            identity = uuid.uuid4().hex
            path.write_text(identity, encoding="ascii")
    # A copied project still receives a distinct scope at a different location.
    value = identity + "\0" + os.path.normcase(str(root))
    return "project:" + hashlib.sha256(value.encode("utf-8")).hexdigest()
