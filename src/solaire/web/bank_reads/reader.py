"""Small helpers for the question bank read paths."""

from __future__ import annotations

import re

from solaire.exam_compiler.facade import strip_primebrush_fences_for_preview

_ANSWER_RELATION_RE = re.compile(r"或者|而且|或|且|和")


def answer_relation_needs_review(answer: str | None) -> bool:
    if not answer:
        return False
    return not answer.startswith(":::ANSWER_LOGIC:") and bool(_ANSWER_RELATION_RE.search(answer))


def preview_text(content: str, n: int = 200) -> str:
    text = content or ""
    if "```" in text or ":::EMBED_IMG:" in text:
        preview = strip_primebrush_fences_for_preview(text, max_len=10_000)
        preview = preview.replace("\n", " ")
    else:
        preview = " ".join(text.split())
        if len(preview) > 10_000:
            preview = preview[:9_997] + "..."
    return preview if len(preview) <= n else preview[: n - 3] + "..."
