from __future__ import annotations

from pathlib import Path

import pytest
from fastapi import HTTPException

from solaire.exam_compiler.models import QuestionGroupRecord, QuestionItem
from solaire.web import bank_service


def test_web_diagram_expansion_rejects_outside_image_dir_before_writing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    root = tmp_path / "project"
    root.mkdir()
    outside_library = tmp_path.parent / f"{tmp_path.name}-outside-library"
    expansion_calls: list[Path] = []

    monkeypatch.setattr(
        bank_service,
        "library_root_for_namespace",
        lambda _root, _namespace: outside_library,
    )

    def tracked_expand(*args, image_dir: Path, **kwargs):
        expansion_calls.append(image_dir)
        return args[0], kwargs.get("primebrush_start", 0), kwargs.get("mermaid_start", 0)

    monkeypatch.setattr(bank_service, "expand_diagram_fences_in_text", tracked_expand)
    question = QuestionItem(
        id="unsafe-image-path",
        type="fill",
        content="```primebrush\nA -> B\n```",
        answer="",
    )

    with pytest.raises(HTTPException) as error:
        bank_service.expand_question_for_web(root, "math/set", question)

    assert error.value.status_code == 400
    assert expansion_calls == []
    assert not outside_library.exists()


def test_web_group_diagram_expansion_rejects_outside_image_dir_before_writing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    root = tmp_path / "project"
    root.mkdir()
    outside_library = tmp_path.parent / f"{tmp_path.name}-outside-group-library"
    expansion_calls: list[Path] = []

    monkeypatch.setattr(
        bank_service,
        "library_root_for_namespace",
        lambda _root, _namespace: outside_library,
    )

    def tracked_expand(*args, image_dir: Path, **kwargs):
        expansion_calls.append(image_dir)
        return args[0], kwargs.get("primebrush_start", 0), kwargs.get("mermaid_start", 0)

    monkeypatch.setattr(bank_service, "expand_diagram_fences_in_text", tracked_expand)
    group = QuestionGroupRecord(
        id="unsafe-group-image-path",
        material="```mermaid\ngraph TD; A-->B\n```",
        unified="fill",
        items=[{"content": "Question", "answer": "Answer"}],
    )

    with pytest.raises(HTTPException) as error:
        bank_service._expand_group_record_for_web(root, "math/set", group)

    assert error.value.status_code == 400
    assert expansion_calls == []
    assert not outside_library.exists()
