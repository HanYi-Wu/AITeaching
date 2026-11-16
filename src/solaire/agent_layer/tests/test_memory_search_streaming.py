"""Streaming memory search retains the existing output contract."""

from __future__ import annotations

from pathlib import Path

from solaire.agent_layer.memory import memory_dir, search_topics


def _legacy_search(project_root: Path, query: str, max_hits: int) -> list[dict[str, str]]:
    root = memory_dir(project_root) / "topics"
    q = query.lower().strip()
    hits: list[dict[str, str]] = []
    for path in sorted(root.glob("*.md")):
        text = path.read_text(encoding="utf-8", errors="replace")
        if not q or q in text.lower():
            snippet = text[:400].replace("\n", " ")
            if len(text) > 400:
                snippet += "…"
            hits.append({"topic": path.name, "snippet": snippet})
            if len(hits) >= max_hits:
                break
    return hits


def test_streaming_search_matches_legacy_substring_and_snippet_results(tmp_path):
    topics = memory_dir(tmp_path) / "topics"
    long_text = ("前置文本\n" * 80) + "Boundary\nMatch Σ final sigma\r\n后续记录"
    (topics / "a-topic.md").write_bytes(long_text.encode("utf-8"))
    (topics / "b-topic.md").write_bytes(("ordinary\n" * 90).encode("utf-8"))
    (topics / "c-topic.md").write_bytes(("other\n" * 70 + "needle").encode("utf-8"))

    for query in ("boundary\nmatch", "Σ final", "needle", "missing", ""):
        assert search_topics(tmp_path, query, max_hits=5) == _legacy_search(tmp_path, query, 5)


def test_streaming_search_preserves_max_hits_edge_behavior(tmp_path):
    topics = memory_dir(tmp_path) / "topics"
    for index in range(3):
        (topics / f"topic-{index}.md").write_text("match", encoding="utf-8")

    assert search_topics(tmp_path, "match", max_hits=0) == _legacy_search(tmp_path, "match", 0)
    assert search_topics(tmp_path, "match", max_hits=-2) == _legacy_search(tmp_path, "match", -2)
