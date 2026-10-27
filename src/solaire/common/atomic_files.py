"""Replace text files without truncating the previous document on write failure."""

import os
from pathlib import Path
import stat
import tempfile


def write_text_atomic(path: Path, content: str) -> None:
    _write_atomic(path, content)


def write_bytes_atomic(path: Path, content: bytes) -> None:
    _write_atomic(path, content)


def _write_atomic(path: Path, content: str | bytes) -> None:
    path = path.resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    temporary = Path(name)
    try:
        options = {"encoding": "utf-8", "newline": ""} if isinstance(content, str) else {}
        with os.fdopen(descriptor, "w" if isinstance(content, str) else "wb", **options) as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        if path.is_file():
            os.chmod(temporary, stat.S_IMODE(path.stat().st_mode))
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)
