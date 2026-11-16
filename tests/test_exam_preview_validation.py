from __future__ import annotations

import pytest

from solaire.exam_compiler.loaders.questions import LoadedQuestions
from solaire.exam_compiler.models import (
    ExamConfig,
    ExamTemplate,
    QuestionItem,
    SelectedSection,
    TemplateSection,
)
from solaire.exam_compiler.pipeline.hydrate import hydrate
from solaire.exam_compiler.pipeline.validate import (
    _normalize_and_validate_exam_preview,
    normalize_exam_for_preview,
    validate_exam,
    validate_exam_preview,
)


def _exam(selected_items: list[SelectedSection], *, template_ref: str = "preview") -> ExamConfig:
    return ExamConfig(
        exam_id="preview-paper",
        template_ref=template_ref,
        selected_items=selected_items,
    )


def _item(question_id: str, question_type: str = "fill") -> QuestionItem:
    values = dict(
        id=question_id,
        type=question_type,
        content=f"题干 {question_id}",
        answer="答案",
    )
    if question_type in {"choice", "single_choice", "multiple_choice"}:
        values["options"] = {"A": "选项"}
    return QuestionItem(**values)


def test_preview_preparation_normalizes_and_validates_with_legacy_output() -> None:
    template = ExamTemplate(
        template_id="preview",
        sections=[
            TemplateSection(section_id="A", type="fill", required_count=2, score_per_item=1),
            TemplateSection(section_id="P", type="practice", required_count=0, score_per_item=1),
            TemplateSection(section_id="T", type="text", required_count=0, score_per_item=0),
            TemplateSection(
                section_id="M", type="multiple_choice", required_count=1, score_per_item=2
            ),
            TemplateSection(section_id="N", type="short_answer", required_count=1, score_per_item=3),
        ],
    )
    exam = _exam(
        [
            SelectedSection(
                section_id="A",
                question_ids=["bank/f1", "bank/f2", "bank/not-loaded"],
                score_per_item=1.5,
                score_overrides={"bank/f1": 2.5},
            ),
            SelectedSection(section_id="P", question_ids=["bank/c1"]),
            SelectedSection(section_id="T", question_ids=["bank/not-loaded"]),
            SelectedSection(section_id="M", question_ids=["bank/m1"]),
            SelectedSection(section_id="obsolete", question_ids=["bank/not-loaded"]),
        ]
    )
    loaded = LoadedQuestions(
        by_qualified={
            "bank/f1": _item("f1"),
            "bank/f2": _item("f2"),
            "bank/c1": _item("c1", "single_choice"),
            "bank/m1": _item("m1", "multiple_choice"),
        }
    )

    expected, expected_warnings = normalize_exam_for_preview(exam, template)
    validate_exam_preview(expected, template, loaded)
    actual, actual_warnings = _normalize_and_validate_exam_preview(exam, template, loaded)

    assert actual.model_dump(mode="json") == expected.model_dump(mode="json")
    assert actual.model_dump(exclude_unset=True) == expected.model_dump(exclude_unset=True)
    assert actual_warnings == expected_warnings == [
        "模板外的小节「obsolete」已在预览中忽略。",
        "小节「A」最多需要 2 道题，预览中已截断多余选题。",
        "小节「T」为卷面说明，预览中已忽略其下的题目。",
        "小节「N」尚未选题，预览中将以空小节占位。",
    ]

    expected_hydrated = hydrate(expected, template, loaded)
    actual_hydrated = hydrate(actual, template, loaded)
    assert actual_hydrated.metadata == expected_hydrated.metadata
    assert actual_hydrated.graphicspath_roots == expected_hydrated.graphicspath_roots
    assert [
        (section.section_id, section.type, section.score_per_item,
         [(q.qualified_id, q.item.id, q.item_score) for q in section.questions])
        for section in actual_hydrated.sections
    ] == [
        (section.section_id, section.type, section.score_per_item,
         [(q.qualified_id, q.item.id, q.item_score) for q in section.questions])
        for section in expected_hydrated.sections
    ]


@pytest.mark.parametrize(
    ("template_ref", "sections", "selected_items", "loaded", "expected_message"),
    [
        (
            "other-template",
            [TemplateSection(section_id="A", type="fill", required_count=1, score_per_item=1)],
            [SelectedSection(section_id="A", question_ids=["bank/missing"])],
            LoadedQuestions(),
            "试卷绑定的版式与当前打开的模板不一致",
        ),
        (
            "preview",
            [TemplateSection(section_id="A", type="fill", required_count=1, score_per_item=1)],
            [SelectedSection(section_id="A", question_ids=["bank/missing"])],
            LoadedQuestions(),
            "题库中未找到题目「bank/missing」",
        ),
        (
            "preview",
            [TemplateSection(section_id="A", type="fill", required_count=1, score_per_item=1)],
            [SelectedSection(section_id="A", question_ids=["bank/choice"])],
            LoadedQuestions(by_qualified={"bank/choice": _item("choice", "single_choice")}),
            "题目「bank/choice」的题型为「single_choice」",
        ),
    ],
)
def test_preview_preparation_preserves_validation_errors(
    template_ref: str,
    sections: list[TemplateSection],
    selected_items: list[SelectedSection],
    loaded: LoadedQuestions,
    expected_message: str,
) -> None:
    template = ExamTemplate(template_id="preview", sections=sections)
    exam = _exam(selected_items, template_ref=template_ref)

    normalized, _warnings = normalize_exam_for_preview(exam, template)
    with pytest.raises(ValueError) as legacy_error:
        validate_exam_preview(normalized, template, loaded)
    with pytest.raises(ValueError) as combined_error:
        _normalize_and_validate_exam_preview(exam, template, loaded)

    assert str(combined_error.value) == str(legacy_error.value)
    assert expected_message in str(combined_error.value)


def test_preview_validation_keeps_first_template_section_for_duplicate_ids() -> None:
    template = ExamTemplate(
        template_id="preview",
        sections=[
            TemplateSection(section_id="A", type="fill", required_count=1, score_per_item=1),
            TemplateSection(
                section_id="A", type="short_answer", required_count=1, score_per_item=2
            ),
        ],
    )
    exam = _exam([SelectedSection(section_id="A", question_ids=["bank/f1"])])
    loaded = LoadedQuestions(by_qualified={"bank/f1": _item("f1")})

    expected, expected_warnings = normalize_exam_for_preview(exam, template)
    validate_exam_preview(expected, template, loaded)
    actual, actual_warnings = _normalize_and_validate_exam_preview(exam, template, loaded)

    assert actual.model_dump(mode="json") == expected.model_dump(mode="json")
    assert actual_warnings == expected_warnings == []


def test_preview_normalization_detaches_mutable_selection_fields() -> None:
    template = ExamTemplate(
        template_id="preview",
        sections=[TemplateSection(section_id="A", type="fill", required_count=1, score_per_item=1)],
    )
    source_section = SelectedSection(
        section_id="A",
        question_ids=["bank/f1"],
        score_overrides={"bank/f1": 2.5},
    )
    exam = _exam([source_section])

    normalized, _warnings = normalize_exam_for_preview(exam, template)
    normalized_section = normalized.selected_items[0]
    normalized_section.question_ids.append("bank/f2")
    normalized_section.score_overrides["bank/f1"] = 9

    assert source_section.question_ids == ["bank/f1"]
    assert source_section.score_overrides == {"bank/f1": 2.5}
    assert normalized_section.model_dump(exclude_unset=True) == {
        "section_id": "A",
        "question_ids": ["bank/f1", "bank/f2"],
        "score_per_item": None,
        "score_overrides": {"bank/f1": 9.0},
        "required_count": None,
    }


def test_public_preview_normalizer_revalidates_mutated_exam_models() -> None:
    template = ExamTemplate(
        template_id="preview",
        sections=[TemplateSection(section_id="A", type="fill", required_count=1, score_per_item=1)],
    )
    section = SelectedSection(section_id="A", question_ids=["bank/f1"])
    section.required_count = -1
    exam = _exam([section])

    with pytest.raises(ValueError, match="greater than or equal to 0"):
        normalize_exam_for_preview(exam, template)

    section.question_ids = None  # type: ignore[assignment]
    with pytest.raises(TypeError):
        normalize_exam_for_preview(exam, template)


def test_strict_validation_keeps_first_template_section_for_duplicate_ids() -> None:
    template = ExamTemplate(
        template_id="preview",
        sections=[
            TemplateSection(section_id="A", type="fill", required_count=1, score_per_item=1),
            TemplateSection(
                section_id="A", type="short_answer", required_count=1, score_per_item=2
            ),
        ],
    )
    exam = _exam([SelectedSection(section_id="A", question_ids=["bank/f1"])])
    loaded = LoadedQuestions(by_qualified={"bank/f1": _item("f1")})

    validate_exam(exam, template, loaded)


def test_strict_validation_reports_missing_and_extra_sections() -> None:
    template = ExamTemplate(
        template_id="preview",
        sections=[
            TemplateSection(section_id="B", type="fill", required_count=0, score_per_item=1),
            TemplateSection(section_id="A", type="fill", required_count=0, score_per_item=1),
        ],
    )
    exam = _exam(
        [
            SelectedSection(section_id="A", question_ids=[]),
            SelectedSection(section_id="Z", question_ids=[]),
        ]
    )

    with pytest.raises(ValueError) as error:
        validate_exam(exam, template, LoadedQuestions())

    assert str(error.value) == "选题结构与模板要求不一致（缺少小节：B；存在模板外的小节：Z）。"
