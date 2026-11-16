from __future__ import annotations

from pathlib import Path
from typing import Any

from solaire.exam_compiler.loaders.questions import LoadedQuestions
from solaire.exam_compiler.models import QuestionItem
from solaire.web import remediation_service


def _question(question_id: str) -> QuestionItem:
    return QuestionItem(
        id=question_id,
        type="fill",
        content=f"题干 {question_id}",
        answer="答案",
    )


def test_remediation_plan_loads_suggested_ids_and_preserves_node_payload_order(
    tmp_path: Path, monkeypatch
) -> None:
    source_doc = {
        "selected_items": [{"question_ids": ["bank/source"]}],
    }
    suggestions = {
        "practice_drafts": [
            {
                "node_id": "n2",
                "canonical_name": "second",
                "suggested_question_ids": [
                    "bank/q2",
                    "bank/source",
                    "bank/missing",
                    "bank/q2",
                ],
            },
            {
                "node_id": "n1",
                "canonical_name": "first",
                "suggested_question_ids": [
                    "bank/q1",
                    "bank/q2",
                    "bank/source",
                    "bank/invalid",
                ],
            },
            {
                "node_id": "n3",
                "canonical_name": "third",
                "suggested_question_ids": ["bank/source", "bank/source"],
            },
            {
                "node_id": "n4",
                "canonical_name": "fourth",
                "suggested_question_ids": ["bank/missing-a", "bank/missing-b"],
            },
            None,
        ],
        "retell_priority": [
            {"node_id": "n2", "error_rate": 0.8, "mastery_fuzzy": True},
        ],
    }
    loaded = LoadedQuestions(
        by_qualified={
            "bank/q1": _question("q1"),
            "bank/q2": _question("q2"),
            "bank/source": _question("source"),
            "bank/invalid": object(),  # type: ignore[dict-item]
        }
    )
    captured: dict[str, Any] = {}

    monkeypatch.setattr(
        remediation_service,
        "load_exam_workspace",
        lambda *_args: source_doc,
    )
    monkeypatch.setattr(
        remediation_service,
        "teaching_suggestions_v1",
        lambda *_args, **_kwargs: suggestions,
    )

    def load_selected(
        _project_root: Path,
        *,
        selected_qualified_ids: set[str] | None = None,
    ) -> LoadedQuestions:
        captured["selected_qualified_ids"] = selected_qualified_ids
        return loaded

    monkeypatch.setattr(remediation_service, "_load_project_questions", load_selected)

    plan = remediation_service.plan_remediation_draft(
        tmp_path,
        exam_id="期中/数学",
        batch_id="batch-1",
    )

    assert captured["selected_qualified_ids"] == {
        "bank/q1",
        "bank/q2",
        "bank/source",
        "bank/missing",
        "bank/invalid",
        "bank/missing-a",
        "bank/missing-b",
    }
    assert plan["selected_question_ids"] == ["bank/q2", "bank/q1"]
    assert [node["node_id"] for node in plan["nodes"]] == ["n2", "n1", "n3", "n4"]
    assert plan["nodes"][0]["selected_question_ids"] == ["bank/q2"]
    assert plan["nodes"][0]["excluded_source_question_ids"] == ["bank/source"]
    assert plan["nodes"][0]["missing_question_ids"] == ["bank/missing"]
    assert plan["nodes"][0]["error_rate"] == 0.8
    assert plan["nodes"][2]["gap_reason"] == "only_source_exam_questions"
    assert plan["nodes"][3]["missing_question_ids"] == ["bank/missing-a", "bank/missing-b"]
    assert plan["warnings"] == [
        "third 暂无可直接生成的补练题。",
        "fourth 暂无可直接生成的补练题。",
    ]
    assert [node["node_id"] for node in plan["weak_nodes"]] == ["n2", "n1", "n3", "n4"]


def test_project_question_loader_forwards_selection_filter(
    tmp_path: Path, monkeypatch
) -> None:
    probe = tmp_path / "probe.yaml"
    probe.write_text(
        "question_libraries:\n  - namespace: bank\n    path: resource\n",
        encoding="utf-8",
    )
    loaded = LoadedQuestions()
    captured: dict[str, Any] = {}

    monkeypatch.setattr(remediation_service, "ensure_probe_list_yaml", lambda _root: probe)

    def load_all(
        probe_path: Path,
        libraries: list[tuple[str, str]],
        *,
        selected_qualified_ids: set[str] | None = None,
    ) -> LoadedQuestions:
        captured["probe"] = probe_path
        captured["libraries"] = libraries
        captured["selected_qualified_ids"] = selected_qualified_ids
        return loaded

    monkeypatch.setattr(remediation_service, "load_all_questions", load_all)

    result = remediation_service._load_project_questions(
        tmp_path,
        selected_qualified_ids={"bank/q1", "bank/q2"},
    )

    assert result is loaded
    assert captured == {
        "probe": probe,
        "libraries": [("bank", "resource")],
        "selected_qualified_ids": {"bank/q1", "bank/q2"},
    }


def test_create_reuses_the_source_exam_document_for_planning(
    tmp_path: Path, monkeypatch
) -> None:
    source_doc = {
        "subject": "数学",
        "export_label": "期中",
        "selected_items": [],
    }
    source_loads = 0
    suggestions_calls = 0
    question = _question("q1")
    saved: dict[str, Any] = {}

    def load_source(*_args) -> dict[str, Any]:
        nonlocal source_loads
        source_loads += 1
        return source_doc

    def suggest(*_args, **_kwargs) -> dict[str, Any]:
        nonlocal suggestions_calls
        suggestions_calls += 1
        return {
            "practice_drafts": [
                {"node_id": "n1", "canonical_name": "薄弱点", "suggested_question_ids": ["bank/q1"]}
            ],
            "retell_priority": [],
        }

    def save(_root: Path, **kwargs: Any) -> dict[str, Any]:
        saved.update(kwargs)
        return {"exam_id": "补练 - 期中/数学", "name": kwargs["export_label"]}

    monkeypatch.setattr(remediation_service, "load_exam_workspace", load_source)
    monkeypatch.setattr(remediation_service, "teaching_suggestions_v1", suggest)
    monkeypatch.setattr(
        remediation_service,
        "_load_project_questions",
        lambda *_args, **_kwargs: LoadedQuestions(by_qualified={"bank/q1": question}),
    )
    monkeypatch.setattr(
        remediation_service,
        "ensure_remediation_practice_template",
        lambda _root: ("remediation_practice", ".solaire/internal_templates/remediation_practice.yaml"),
    )
    monkeypatch.setattr(remediation_service, "_save_with_unique_label", save)

    result = remediation_service.create_remediation_draft(
        tmp_path,
        exam_id="期中/数学",
        batch_id="batch-2",
    )

    assert source_loads == 1
    assert suggestions_calls == 1
    assert saved["selected_items"] == [
        {"section_id": "练习题", "question_ids": ["bank/q1"], "score_per_item": 5}
    ]
    assert result["selected_count"] == 1
    assert result["source_exam_id"] == "期中/数学"
    assert result["source_batch_id"] == "batch-2"
