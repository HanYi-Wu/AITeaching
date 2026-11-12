from __future__ import annotations

from contextlib import closing
import hashlib
import json
from pathlib import Path
from typing import Any

import pytest
import yaml
from pydantic import ValidationError

from solaire.common.actor_context import actor
from solaire.web import platform_db
from solaire.web.auto_compose.service import check_paper_duplicates, generate_paper
from solaire.web.schemas.auto_compose import AutoComposeBody, DuplicateCheckBody


@pytest.fixture(autouse=True)
def _isolate_platform_database(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Every auto-compose integration case uses a platform database under tmp_path."""
    from solaire.web.auto_compose import catalog

    monkeypatch.setattr(catalog, "default_platform_root", lambda: tmp_path)
    monkeypatch.setattr(platform_db, "default_platform_root", lambda: tmp_path)


def _write_template(root: Path, sections: list[dict[str, Any]]) -> Path:
    templates = root / "templates"
    templates.mkdir(parents=True, exist_ok=True)
    path = templates / "goal-template.yaml"
    path.write_text(
        yaml.safe_dump(
            {
                "template_id": "goal-template-v1",
                "layout": "single_column",
                "sections": sections,
            },
            allow_unicode=True,
            sort_keys=False,
        ),
        encoding="utf-8",
    )
    return path


def _write_question(
    root: Path,
    question_id: str,
    question_type: str,
    *,
    difficulty: str | None = "medium",
    knowledge_points: list[str] | None = None,
    content: str | None = None,
    options: dict[str, str] | None = None,
    answer: str | None = None,
) -> str:
    library = root / "resource" / "数学" / "基础题库"
    library.mkdir(parents=True, exist_ok=True)
    question: dict[str, Any] = {
        "id": question_id,
        "type": question_type,
        "content": content or f"计算题目 {question_id}。",
        "answer": answer or ("A" if question_type in {"choice", "single_choice", "multiple_choice"} else "42"),
        "metadata": {"knowledge_points": knowledge_points or []},
    }
    if difficulty is not None:
        question["metadata"]["difficulty"] = difficulty
    if question_type in {"choice", "single_choice", "multiple_choice"}:
        question["options"] = options or {"A": "答案一", "B": "答案二"}
    path = library / f"{question_id}.yaml"
    path.write_text(yaml.safe_dump(question, allow_unicode=True, sort_keys=False), encoding="utf-8")
    return f"数学/基础题库/{question_id}"


def _write_teacher_question(
    root: Path, teacher_id: str, question_id: str, content: str, *, subject: str = "数学"
) -> str:
    key = hashlib.sha256(teacher_id.encode("utf-8")).hexdigest()
    library = root / "resource" / "__teachers" / key
    library.mkdir(parents=True, exist_ok=True)
    (library / ".initialized").write_text("1", encoding="ascii")
    (library / ".ownership-v2").write_text("1", encoding="ascii")
    path = library / subject / "基础题库" / f"{question_id}.yaml"
    path.parent.mkdir(parents=True, exist_ok=True)
    question = {
        "id": question_id,
        "type": "fill",
        "content": content,
        "answer": "42",
        "metadata": {"difficulty": "medium", "knowledge_points": ["函数"]},
    }
    path.write_text(yaml.safe_dump(question, allow_unicode=True, sort_keys=False), encoding="utf-8")
    return f"{subject}/基础题库/{question_id}"


def _write_two_subject_graphs(root: Path, math_qid: str, physics_qid: str) -> None:
    graph_dir = root / "resource" / "graph"
    graph_dir.mkdir(parents=True, exist_ok=True)
    (graph_dir / "_meta.yaml").write_text(
        yaml.safe_dump(
            {
                "version": 1,
                "subjects": [
                    {"slug": "math", "display_name": "数学", "node_count": 1},
                    {"slug": "physics", "display_name": "物理", "node_count": 1},
                ],
                "levels": ["高中"],
            },
            allow_unicode=True,
            sort_keys=False,
        ),
        encoding="utf-8",
    )
    for slug, node_id, name, subject, qid in (
        ("math", "math-node", "代数", "数学", math_qid),
        ("physics", "physics-node", "力学", "物理", physics_qid),
    ):
        (graph_dir / f"{slug}.yaml").write_text(
            yaml.safe_dump(
                {
                    "version": 1,
                    "taxonomy": {"subjects": [subject], "levels": ["高中"]},
                    "nodes": [{
                        "id": node_id,
                        "canonical_name": name,
                        "subject": subject,
                        "aliases": [],
                    }],
                    "bindings": [{"question_qualified_id": qid, "node_id": node_id}],
                },
                allow_unicode=True,
                sort_keys=False,
            ),
            encoding="utf-8",
        )


def _write_exam_history(root: Path, exam_id: str, teacher_id: str, question_ids: list[str]) -> None:
    label, subject = exam_id.split("/", 1)
    folder = root / "exams" / label / subject
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "exam.yaml").write_text(
        yaml.safe_dump(
            {
                "exam_id": exam_id,
                "metadata": {"title": exam_id, "owner_teacher_id": teacher_id},
                "selected_items": [{"section_id": "s1", "question_ids": question_ids}],
            },
            allow_unicode=True,
            sort_keys=False,
        ),
        encoding="utf-8",
    )


def _seed_historical_snapshot(
    root: Path,
    *,
    exam_id: str,
    teacher_id: str,
    questions: list[dict[str, Any]],
) -> None:
    """Seed a frozen online-attempt snapshot without depending on live bank files."""
    platform_db.init_platform_db(root)
    with closing(platform_db.connect(root)) as con, con:
        con.execute(
            "INSERT OR IGNORE INTO schools (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)",
            ("school-1", "测试学校", "now", "now"),
        )
        for user_id, role in ((teacher_id, "teacher"), ("student-1", "student")):
            con.execute(
                "INSERT OR IGNORE INTO users (id, role, username, password_hash, display_name, created_at, updated_at) "
                "VALUES (?, ?, ?, 'hash', ?, 'now', 'now')",
                (user_id, role, user_id, user_id),
            )
        con.execute(
            "INSERT OR IGNORE INTO students (id, school_id, user_id, student_no, display_name, created_at, updated_at) "
            "VALUES ('student-record-1', 'school-1', 'student-1', 'S1', '测试学生', 'now', 'now')"
        )
        paper_id = f"paper-{exam_id.replace('/', '-')}"
        publication_id = f"publication-{exam_id.replace('/', '-')}"
        attempt_id = f"attempt-{exam_id.replace('/', '-')}"
        con.execute(
            "INSERT OR IGNORE INTO paper_records "
            "(id, exam_id, title, subject, owner_teacher_id, status, created_at, updated_at) "
            "VALUES (?, ?, ?, '数学', ?, 'published', 'now', 'now')",
            (paper_id, exam_id, exam_id, teacher_id),
        )
        con.execute(
            "INSERT OR IGNORE INTO exam_publications "
            "(id, paper_id, teacher_id, title, status, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, 'published', 'now', 'now')",
            (publication_id, paper_id, teacher_id, exam_id),
        )
        con.execute(
            "INSERT OR IGNORE INTO student_attempts "
            "(id, publication_id, student_id, status, submitted_at, question_payload_json) "
            "VALUES (?, ?, 'student-record-1', 'submitted', 'now', ?)",
            (attempt_id, publication_id, json.dumps(questions, ensure_ascii=False)),
        )


def _report_matches(report: dict[str, Any]) -> list[tuple[dict[str, Any], dict[str, Any]]]:
    return [
        (question, match)
        for question in report.get("questions", [])
        for match in question.get("matches", [])
    ]


def _has_match(
    report: dict[str, Any],
    *,
    kind: str | None = None,
    source: str | None = None,
    qualified_id: str | None = None,
) -> bool:
    for _question, match in _report_matches(report):
        if kind is not None and match.get("kind") != kind:
            continue
        if source is not None and match.get("source") != source:
            continue
        if qualified_id is not None and match.get("qualified_id") != qualified_id:
            continue
        return True
    return False


def _duplicate_body(*question_ids: str, **overrides: Any) -> DuplicateCheckBody:
    values: dict[str, Any] = {"question_ids": list(question_ids)}
    values.update(overrides)
    return DuplicateCheckBody.model_validate(values)


def _body(**overrides: Any) -> AutoComposeBody:
    values: dict[str, Any] = {
        "template_path": "templates/goal-template.yaml",
        "template_ref": "goal-template-v1",
        "subject": "数学",
        "total_count": 1,
    }
    values.update(overrides)
    return AutoComposeBody.model_validate(values)


def _selected_ids(result: dict[str, Any]) -> list[str]:
    return [qid for section in result["selected_items"] for qid in section["question_ids"]]


def _basic_sections(*, choice_count: int = 1, fill_count: int = 1, reasoning_count: int = 1) -> list[dict[str, Any]]:
    return [
        {"section_id": "instruction", "type": "text", "required_count": 0, "score_per_item": 0},
        {"section_id": "choice", "type": "choice", "required_count": choice_count, "score_per_item": 2},
        {"section_id": "fill", "type": "fill", "required_count": fill_count, "score_per_item": 3},
        {"section_id": "reasoning", "type": "reasoning", "required_count": reasoning_count, "score_per_item": 5},
    ]


def test_schema_rejects_non_finite_and_inconsistent_targets() -> None:
    base = {
        "template_path": "templates/goal-template.yaml",
        "subject": "数学",
        "total_count": 4,
    }

    with pytest.raises(ValidationError):
        AutoComposeBody.model_validate({**base, "coverage_ratio": float("nan")})
    with pytest.raises(ValidationError):
        AutoComposeBody.model_validate({**base, "difficulty_distribution": {"easy": float("inf")}})
    with pytest.raises(ValidationError):
        AutoComposeBody.model_validate({**base, "difficulty_distribution": {"easy": 0, "hard": 0}})
    with pytest.raises(ValidationError):
        AutoComposeBody.model_validate({**base, "type_distribution": {"choice": 1, "single_choice": 1}})
    with pytest.raises(ValidationError):
        AutoComposeBody.model_validate({**base, "type_distribution": {"fill": 1}, "section_counts": {"fill": 4}})
    with pytest.raises(ValidationError):
        AutoComposeBody.model_validate({**base, "section_counts": {"fill": 3}})


def test_joint_goals_cover_knowledge_difficulty_and_types(tmp_path: Path) -> None:
    _write_template(tmp_path, _basic_sections())
    _write_question(tmp_path, "choice-easy", "single_choice", difficulty="easy", knowledge_points=["函数"])
    _write_question(tmp_path, "fill-medium", "fill", difficulty="medium", knowledge_points=["概率"])
    _write_question(tmp_path, "reasoning-hard", "reasoning", difficulty="hard", knowledge_points=["函数", "概率"])

    result = generate_paper(
        tmp_path,
        _body(
            total_count=3,
            knowledge_points=["函数", "概率"],
            coverage_ratio=1,
            difficulty_distribution={"easy": 1, "medium": 1, "hard": 1},
            type_distribution={"single_choice": 1, "fill": 1, "reasoning": 1},
            seed=31,
        ),
    )

    assert result["complete"] is True
    assert result["requested_count"] == result["generated_count"] == 3
    assert result["goals"]["knowledge"]["met"] is True
    assert set(result["goals"]["knowledge"]["covered_points"]) == {"函数", "概率"}
    assert result["goals"]["difficulty"]["met"] is True
    assert result["goals"]["difficulty"]["actual"] == {"easy": 1, "medium": 1, "hard": 1, "unknown": 0}
    assert result["goals"]["types"]["met"] is True
    assert len(_selected_ids(result)) == len(set(_selected_ids(result))) == 3


def test_joint_solver_reassigns_a_greedy_choice_to_meet_section_and_difficulty_goals(tmp_path: Path) -> None:
    _write_template(
        tmp_path,
        [
            {"section_id": "instruction", "type": "text", "required_count": 0, "score_per_item": 0},
            {"section_id": "choice", "type": "choice", "required_count": 1, "score_per_item": 2},
            {"section_id": "fill", "type": "fill", "required_count": 1, "score_per_item": 3},
        ],
    )
    _write_question(tmp_path, "choice-easy", "single_choice", difficulty="easy", knowledge_points=["容易点"])
    _write_question(tmp_path, "choice-hard", "single_choice", difficulty="hard", knowledge_points=["难点"])
    _write_question(tmp_path, "fill-easy", "fill", difficulty="easy", knowledge_points=["容易点"])
    _write_question(tmp_path, "fill-medium", "fill", difficulty="medium", knowledge_points=["中等点"])

    result = generate_paper(
        tmp_path,
        _body(
            total_count=2,
            section_counts={"choice": 1, "fill": 1},
            difficulty_distribution={"easy": 1, "hard": 1},
            knowledge_points=["难点", "容易点"],
            seed=7,
        ),
    )

    selected_by_section = {section["section_id"]: section["question_ids"] for section in result["selected_items"]}
    assert selected_by_section["choice"] == ["数学/基础题库/choice-hard"]
    assert selected_by_section["fill"] == ["数学/基础题库/fill-easy"]
    assert result["goals"]["difficulty"]["met"] is True
    assert result["goals"]["knowledge"]["met"] is True
    assert result["complete"] is True


def test_text_practice_and_group_sections_accept_mixed_and_unified_group_records(tmp_path: Path) -> None:
    _write_template(
        tmp_path,
        [
            {"section_id": "instruction", "type": "text", "required_count": 0, "score_per_item": 0},
            {"section_id": "practice", "type": "practice", "required_count": 1, "score_per_item": 2},
            {"section_id": "group", "type": "group", "required_count": 1, "score_per_item": 3},
        ],
    )
    library = tmp_path / "resource" / "数学" / "基础题库"
    library.mkdir(parents=True, exist_ok=True)
    (library / "mixed-group.yaml").write_text(
        yaml.safe_dump(
            {
                "id": "mixed-group",
                "type": "group",
                "material": "阅读材料：一次函数的应用。",
                "unified": False,
                "items": [
                    {"type": "fill", "content": "第 1 问的答案是？", "answer": "2", "metadata": {"difficulty": "easy"}},
                    {"type": "single_choice", "content": "第 2 问选择？", "options": {"A": "甲", "B": "乙"}, "answer": "A", "metadata": {"difficulty": "medium"}},
                ],
            },
            allow_unicode=True,
            sort_keys=False,
        ),
        encoding="utf-8",
    )
    (library / "unified-group.yaml").write_text(
        yaml.safe_dump(
            {
                "id": "unified-group",
                "type": "group",
                "material": "阅读材料：二次函数的图像。",
                "unified": "fill",
                "items": [
                    {"content": "材料对应的表达式是？", "answer": "$x^2$", "metadata": {"difficulty": "hard"}},
                ],
            },
            allow_unicode=True,
            sort_keys=False,
        ),
        encoding="utf-8",
    )

    result = generate_paper(
        tmp_path,
        _body(total_count=2, section_counts={"practice": 1, "group": 1}, seed=13),
    )

    selected = {section["section_id"]: section["question_ids"] for section in result["selected_items"]}
    assert selected["instruction"] == []
    assert len(selected["practice"]) == 1
    assert len(selected["group"]) == 1
    assert set(selected["practice"] + selected["group"]) == {
        "数学/基础题库/mixed-group",
        "数学/基础题库/unified-group",
    }
    assert result["complete"] is True


def test_shortage_is_incomplete_and_preserves_requested_section_counts(tmp_path: Path) -> None:
    _write_template(tmp_path, _basic_sections(choice_count=2, fill_count=2, reasoning_count=0))
    _write_question(tmp_path, "only-choice", "single_choice", difficulty="easy")
    _write_question(tmp_path, "only-fill", "fill", difficulty="medium")

    result = generate_paper(
        tmp_path,
        _body(total_count=4, section_counts={"choice": 2, "fill": 2}, seed=2),
    )

    assert result["complete"] is False
    assert result["requested_count"] == 4
    assert result["generated_count"] == 2
    assert len(_selected_ids(result)) == len(set(_selected_ids(result))) == 2
    goals = {row["section_id"]: row for row in result["goals"]["sections"]}
    assert goals["choice"]["requested_count"] == 2
    assert goals["fill"]["requested_count"] == 2
    assert goals["choice"]["actual_count"] == 1
    assert goals["fill"]["actual_count"] == 1
    assert any("未自动降低目标题量" in warning for warning in result["warnings"])


def test_unlabelled_difficulty_is_unknown_not_medium(tmp_path: Path) -> None:
    _write_template(tmp_path, _basic_sections(fill_count=1, choice_count=0, reasoning_count=0))
    _write_question(tmp_path, "unlabelled", "fill", difficulty=None)

    result = generate_paper(
        tmp_path,
        _body(total_count=1, difficulty_distribution={"unknown": 1}, seed=5),
    )

    assert _selected_ids(result) == ["数学/基础题库/unlabelled"]
    assert result["goals"]["difficulty"]["actual"]["unknown"] == 1
    assert result["goals"]["difficulty"]["actual"]["medium"] == 0
    assert any("未标注" in warning for warning in result["warnings"])


def test_seed_makes_selection_reproducible(tmp_path: Path) -> None:
    _write_template(tmp_path, _basic_sections(fill_count=0, choice_count=2, reasoning_count=0))
    for index in range(8):
        _write_question(
            tmp_path,
            f"choice-{index}",
            "single_choice",
            difficulty="medium",
            content=f"互不相同的选择题内容 {index}。",
        )
    body = _body(total_count=2, seed=2026)

    first = generate_paper(tmp_path, body)
    second = generate_paper(tmp_path, body)

    assert _selected_ids(first) == _selected_ids(second)


def test_template_path_must_resolve_to_a_project_template(tmp_path: Path) -> None:
    _write_template(tmp_path, _basic_sections())
    outside = tmp_path / "outside.yaml"
    outside.write_text("template_id: outside\nsections: []\n", encoding="utf-8")

    with pytest.raises(ValueError):
        generate_paper(tmp_path, _body(template_path="../outside.yaml", template_ref=""))


def test_duplicate_check_detects_reordered_choice_options_as_exact(tmp_path: Path) -> None:
    first = _write_question(
        tmp_path,
        "choice-original",
        "single_choice",
        content="下列哪个选项等于 2？",
        options={"A": "2", "B": "3", "C": "4"},
        answer="A",
    )
    second = _write_question(
        tmp_path,
        "choice-reordered",
        "single_choice",
        content="下列哪个选项等于 2？",
        options={"A": "4", "B": "2", "C": "3"},
        answer="B",
    )

    report = check_paper_duplicates(tmp_path, _duplicate_body(first, second, similarity_threshold=0.95))

    assert _has_match(report, kind="exact")
    assert _has_match(report, kind="exact", qualified_id=first)
    assert _has_match(report, kind="exact", qualified_id=second)


@pytest.mark.parametrize(
    ("first_content", "second_content"),
    [
        ("求 $7+5$ 的值。", "求 $7+6$ 的值。"),
        ("已知 $f(x)=x^2+1$，求 $f(2)$。", "已知 $f(x)=x^2+2$，求 $f(2)$。"),
        ("解方程 $x+1=0$。", "解方程 $X+1=0$。"),
    ],
)
def test_numeric_or_formula_variants_are_not_exact_duplicates(
    tmp_path: Path, first_content: str, second_content: str
) -> None:
    first = _write_question(tmp_path, "variant-original", "fill", content=first_content)
    second = _write_question(tmp_path, "variant-changed", "fill", content=second_content)

    report = check_paper_duplicates(tmp_path, _duplicate_body(first, second, similarity_threshold=1.0))

    assert not _has_match(report, kind="exact")


def test_repeated_question_id_is_reported_as_an_in_paper_duplicate(tmp_path: Path) -> None:
    qualified_id = _write_question(tmp_path, "repeated", "fill", content="同一题在卷内出现两次。")

    report = check_paper_duplicates(tmp_path, _duplicate_body(qualified_id, qualified_id))

    rows = [row for row in report["questions"] if row["qualified_id"] == qualified_id]
    assert len(rows) == 1
    assert rows[0]["occurrences"] == 2
    assert rows[0]["match_count"] >= 1
    assert report["summary"]["question_count"] == 2
    assert report["summary"]["within_paper_count"] == 1


def test_deleted_historical_snapshot_is_checked_and_exclude_exam_id_skips_it(tmp_path: Path) -> None:
    current_id = _write_question(tmp_path, "current-copy", "fill", content="求 $x^2+1$ 在 $x=2$ 时的值。")
    old_id = "数学/旧题库/deleted-question"
    exam_id = "history/数学"
    _write_exam_history(tmp_path, exam_id, "teacher-1", [old_id])
    _seed_historical_snapshot(
        tmp_path,
        exam_id=exam_id,
        teacher_id="teacher-1",
        questions=[{
            "question_id": old_id,
            "type": "fill",
            "content": "求 $x^2+1$ 在 $x=2$ 时的值。",
            "options": None,
        }],
    )
    assert not (tmp_path / "resource" / "数学" / "旧题库" / "deleted-question.yaml").exists()

    report = check_paper_duplicates(tmp_path, _duplicate_body(current_id))
    excluded = check_paper_duplicates(
        tmp_path,
        _duplicate_body(current_id, exclude_exam_id=exam_id),
    )

    assert _has_match(report, source="history", kind="exact", qualified_id=old_id)
    assert not _has_match(excluded, source="history", qualified_id=old_id)
    assert not any("无法读取原题面" in warning for warning in report["warnings"])


def test_avoid_history_excludes_exact_snapshot_even_after_source_question_was_deleted(tmp_path: Path) -> None:
    _write_template(tmp_path, _basic_sections(fill_count=1, choice_count=0, reasoning_count=0))
    current_id = _write_question(tmp_path, "new-copy", "fill", content="已知 $3+4$，求和。")
    old_id = "数学/旧题库/removed"
    exam_id = "history/数学"
    _write_exam_history(tmp_path, exam_id, "teacher-1", [old_id])
    _seed_historical_snapshot(
        tmp_path,
        exam_id=exam_id,
        teacher_id="teacher-1",
        questions=[{
            "question_id": old_id,
            "type": "fill",
            "content": "已知 $3+4$，求和。",
            "options": None,
        }],
    )

    result = generate_paper(
        tmp_path,
        _body(total_count=1, avoid_history=True, seed=4),
    )

    assert current_id not in _selected_ids(result)
    assert result["generated_count"] == 0
    assert result["excluded_history_count"] == 1
    assert result["complete"] is False


def test_history_summary_counts_only_history_matches_for_this_paper(tmp_path: Path) -> None:
    current_id = _write_question(tmp_path, "unrelated-current", "fill", content="求 $2+2$ 的值。")
    old_id = "数学/旧题库/unrelated-deleted"
    exam_id = "old-unrelated/数学"
    _write_exam_history(tmp_path, exam_id, "teacher-1", [old_id])
    _seed_historical_snapshot(
        tmp_path,
        exam_id=exam_id,
        teacher_id="teacher-1",
        questions=[{
            "question_id": old_id,
            "type": "fill",
            "content": "证明函数 $g(x)=x^3-3x$ 在区间上的单调性。",
            "options": None,
        }],
    )

    report = check_paper_duplicates(tmp_path, _duplicate_body(current_id))

    assert report["summary"]["history_count"] == 0


def test_duplicate_check_does_not_change_business_files(tmp_path: Path) -> None:
    qid = _write_question(tmp_path, "read-only", "fill", content="只读查重的题面。")
    platform_db.init_platform_db(tmp_path)
    before = {path.relative_to(tmp_path): path.read_bytes() for path in tmp_path.rglob("*") if path.is_file()}

    check_paper_duplicates(tmp_path, _duplicate_body(qid, qid))

    after = {path.relative_to(tmp_path): path.read_bytes() for path in tmp_path.rglob("*") if path.is_file()}
    assert after == before


def test_teacher_private_catalog_and_exam_history_do_not_leak_between_teachers(tmp_path: Path) -> None:
    teacher_a_question = _write_teacher_question(tmp_path, "teacher-a", "visible-a", "同一段私有题面。")
    teacher_b_question = _write_teacher_question(tmp_path, "teacher-b", "visible-b", "同一段私有题面。")
    hidden_id = "数学/旧题库/deleted-by-b"
    exam_id = "history-b/数学"
    _write_exam_history(tmp_path, exam_id, "teacher-b", [hidden_id])
    _seed_historical_snapshot(
        tmp_path,
        exam_id=exam_id,
        teacher_id="teacher-b",
        questions=[{
            "question_id": hidden_id,
            "type": "fill",
            "content": "同一段私有题面。",
            "options": None,
        }],
    )

    token = actor.set({"id": "teacher-a", "role": "teacher"})
    try:
        from solaire.web.auto_compose.service import compose_options

        options_a = compose_options(tmp_path, "数学")
        report_a = check_paper_duplicates(tmp_path, _duplicate_body(teacher_a_question))
    finally:
        actor.reset(token)

    token = actor.set({"id": "teacher-b", "role": "teacher"})
    try:
        from solaire.web.auto_compose.service import compose_options

        options_b = compose_options(tmp_path, "数学")
        report_b = check_paper_duplicates(tmp_path, _duplicate_body(teacher_b_question))
    finally:
        actor.reset(token)

    assert options_a["total_count"] == 1
    assert options_b["total_count"] == 1
    assert not _has_match(report_a, source="history", qualified_id=hidden_id)
    assert _has_match(report_b, source="history", kind="exact", qualified_id=hidden_id)


def test_options_include_bindings_from_each_private_subject_graph(tmp_path: Path) -> None:
    teacher_id = "teacher-multi-graph"
    math_qid = _write_teacher_question(tmp_path, teacher_id, "math-question", "平面几何题。")
    physics_qid = _write_teacher_question(
        tmp_path, teacher_id, "physics-question", "物体运动题。", subject="物理"
    )
    token = actor.set({"id": teacher_id, "role": "teacher"})
    try:
        from solaire.web.actor_scope import teacher_graph_root
        from solaire.web.auto_compose.service import compose_options

        private_graph_root = teacher_graph_root(tmp_path, actor.get())
        _write_two_subject_graphs(private_graph_root, math_qid, physics_qid)
        options = compose_options(tmp_path)
    finally:
        actor.reset(token)

    points = {point["id"]: point["name"] for point in options["knowledge_points"]}
    assert points["math-node"] == "代数"
    assert points["physics-node"] == "力学"


def test_auto_compose_router_registers_teacher_only_routes(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from fastapi import HTTPException
    from solaire.web.routers import auto_compose as api

    qid = _write_question(tmp_path, "api-question", "fill", content="API route test question.")
    _write_template(tmp_path, _basic_sections(fill_count=1, choice_count=0, reasoning_count=0))
    monkeypatch.setattr(api, "_require_root", lambda: tmp_path)
    routes = {
        (route.path, method)
        for route in api.router.routes
        for method in getattr(route, "methods", set())
    }
    assert ("/api/exam/auto-compose/options", "GET") in routes
    assert ("/api/exam/auto-compose", "POST") in routes
    assert ("/api/exam/check-duplicates", "POST") in routes

    token = actor.set({"id": "student-user", "role": "student"})
    try:
        with pytest.raises(HTTPException) as denied:
            api._teacher_root()
        assert denied.value.status_code == 403
    finally:
        actor.reset(token)

    token = actor.set({"id": "admin-user", "role": "admin"})
    try:
        assert api.auto_compose_options("数学")["total_count"] == 1
        result = api.auto_compose(_body(total_count=1))
        duplicate_report = api.check_duplicates(_duplicate_body(qid))
    finally:
        actor.reset(token)

    assert result["generated_count"] == 1
    assert _selected_ids(result) == [qid]
    assert duplicate_report["questions"][0]["qualified_id"] == qid

