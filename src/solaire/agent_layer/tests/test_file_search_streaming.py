"""Regression tests for bounded-memory project file search."""

from __future__ import annotations

from solaire.agent_layer.models import InvocationContext
from solaire.agent_layer.tools._streaming_reader import iter_file_lines
from solaire.agent_layer.tools.file_tools import tool_file_search


def test_streaming_lines_match_read_text_splitlines(tmp_path):
    content = "alpha\r\nbeta\rbravo\vvertical\ffeed\x1cfile\x1dgroup\x1erecord\x85next\u2028line\u2029end\n"
    path = tmp_path / "separators.txt"
    path.write_text(content, encoding="utf-8")

    expected = path.read_text(encoding="utf-8", errors="replace").splitlines()
    assert list(iter_file_lines(path)) == expected


def test_file_search_reports_unicode_line_numbers_and_caps_results(tmp_path):
    path = tmp_path / "lesson.txt"
    path.write_bytes("intro\r\nmatch one\u2028match two\r\nmatch three".encode("utf-8"))
    ctx = InvocationContext(session_id="search", project_root=tmp_path)

    result = tool_file_search(
        ctx,
        {"path": ".", "pattern": "match", "max_matches": 2},
    )

    assert result.status == "succeeded"
    assert result.data["matches"] == [
        {"file": "lesson.txt", "line": 2, "text": "match one"},
        {"file": "lesson.txt", "line": 3, "text": "match two"},
    ]
    assert result.data["count"] == 2
