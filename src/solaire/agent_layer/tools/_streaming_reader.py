"""Streaming file window reader with exact splitlines semantics and bounded peak memory."""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path
from typing import Final

# The 10 Unicode line break characters recognized by Python's str.splitlines()
# (0x0a \n, 0x0b \v, 0x0c \f, 0x0d \r, 0x1c FS, 0x1d GS, 0x1e RS, 0x85 NEL, 0x2028 LS, 0x2029 PS)
_LINE_BREAKS: Final[frozenset[str]] = frozenset(
    {"\n", "\r", "\x0b", "\x0c", "\x1c", "\x1d", "\x1e", "\x85", "\u2028", "\u2029"}
)

_DEFAULT_CHUNK_SIZE: Final[int] = 65536


def iter_file_lines(
    path: Path,
    *,
    encoding: str = "utf-8",
    errors: str = "replace",
) -> Iterator[str]:
    """Yield text lines with the same separators as ``str.splitlines()``.

    Text file iteration handles CR/LF/CRLF with the same universal-newline
    translation used by ``Path.read_text``. Splitting each physical line also
    recognizes Python's additional Unicode line separators while keeping the
    whole file out of memory.
    """
    with open(path, "r", encoding=encoding, errors=errors) as file:
        for physical_line in file:
            yield from physical_line.splitlines()


def read_file_window(
    path: Path,
    offset: int = 0,
    limit: int | None = None,
    *,
    chunk_size: int = _DEFAULT_CHUNK_SIZE,
    encoding: str = "utf-8",
    errors: str = "replace",
) -> tuple[int, str]:
    """Read a window of lines [offset, offset + limit) from a text file, streaming in chunks.

    Returns (total_lines, content).
    - Guarantees exact splitlines(keepends=True) total_lines and content semantics.
    - Handles CRLF, standalone CR, LF, and Unicode line separators across chunk boundaries.
    - Limits peak memory to O(chunk_size + window_size), not O(file_size).
    - Always scans to EOF to ensure total_lines is exact.
    """
    if offset < 0:
        offset = 0
    max_count = None if limit is None else int(limit)
    if max_count is not None and max_count < 0:
        # Preserve the prior splitlines slice behavior for a negative limit
        # (all but the last abs(limit) lines). Count first, then read the
        # resulting window without retaining the excluded tail in memory.
        total_lines, _ = read_file_window(
            path,
            offset=0,
            limit=0,
            chunk_size=chunk_size,
            encoding=encoding,
            errors=errors,
        )
        end = max(offset, total_lines + max_count)
        return read_file_window(
            path,
            offset=offset,
            limit=max(0, end - offset),
            chunk_size=chunk_size,
            encoding=encoding,
            errors=errors,
        )
    target_end = None if max_count is None else offset + max_count

    total_lines = 0
    selected_lines: list[str] = []
    buffer = ""
    has_unterminated_tail = False

    with open(path, "r", encoding=encoding, errors=errors) as f:
        while True:
            chunk = f.read(chunk_size)
            if not chunk:
                break

            data = buffer + chunk
            lines = data.splitlines(keepends=True)
            if not lines:
                continue

            # If data ends with '\r', the next chunk could start with '\n' (\r\n),
            # so we must keep the trailing '\r' in buffer for the next read.
            if data.endswith("\r"):
                buffer = lines.pop()
                has_unterminated_tail = True
            elif lines[-1][-1] in _LINE_BREAKS:
                buffer = ""
                has_unterminated_tail = False
            else:
                buffer = lines.pop()
                has_unterminated_tail = True

                # Bounded memory safeguard: if current line is outside the requested window
                # and buffer exceeds chunk_size * 2 (e.g. an extremely long line outside window),
                # discard the buffer content while remembering that an unterminated tail exists.
                curr_line_idx = total_lines + len(lines)
                if curr_line_idx < offset or (target_end is not None and curr_line_idx >= target_end):
                    if len(buffer) > chunk_size * 2:
                        buffer = ""

            num = len(lines)
            if num > 0:
                start_line = total_lines
                end_line = total_lines + num

                if target_end is None or start_line < target_end:
                    if end_line > offset:
                        s_idx = max(0, offset - start_line)
                        e_idx = num if target_end is None else min(num, target_end - start_line)
                        selected_lines.extend(lines[s_idx:e_idx])
                total_lines += num

    if has_unterminated_tail:
        if buffer:
            final_lines = buffer.splitlines(keepends=True)
            for fl in final_lines:
                if offset <= total_lines and (target_end is None or total_lines < target_end):
                    selected_lines.append(fl)
                total_lines += 1
        else:
            total_lines += 1

    return total_lines, "".join(selected_lines)
