from __future__ import annotations

from solaire.exam_compiler.pipeline.hydrate import HydratedExam, HydratedSection
from solaire.exam_compiler.pipeline.render import render_tex


def test_render_tex_does_not_emit_empty_enumerate_for_empty_preview_sections(tmp_path) -> None:
    hydrated = HydratedExam(
        exam_id="preview",
        metadata={"title": "Preview"},
        sections=[
            HydratedSection(
                section_id="Choice",
                type="single_choice",
                score_per_item=5.0,
                questions=[],
                describe="Needs questions",
            )
        ],
    )

    tex = render_tex(hydrated, tmp_path, "exam-zh-base.tex.j2", show_answers=False)

    assert r"\section*{Choice}" in tex
    assert r"\begin{enumerate}" not in tex
    assert r"\end{enumerate}" not in tex
