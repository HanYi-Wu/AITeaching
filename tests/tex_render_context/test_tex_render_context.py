from __future__ import annotations

from inspect import Parameter, signature
from pathlib import Path

from solaire.exam_compiler.loaders.questions import LoadedQuestions
from solaire.exam_compiler.models import QuestionItem
from solaire.exam_compiler.pipeline import render as render_module
from solaire.exam_compiler.pipeline.hydrate import (
    HydratedExam,
    HydratedQuestion,
    HydratedSection,
)


def test_render_tex_keeps_its_existing_signature() -> None:
    parameters = signature(render_module.render_tex).parameters
    assert list(parameters) == [
        "hydrated",
        "template_yaml_dir",
        "latex_base",
        "show_answers",
    ]
    assert parameters["show_answers"].kind is Parameter.KEYWORD_ONLY


def _choice_question(question_id: str, label: str) -> QuestionItem:
    return QuestionItem(
        id=question_id,
        type="single_choice",
        content=f"{label}：选择正确项。",
        options={"B": "选项乙", "A": "选项甲"},
        answer="A",
        analysis=f"{label}解析",
    )


def _sample_exam(question_count: int = 19) -> HydratedExam:
    questions: list[HydratedQuestion] = []
    for index in range(question_count):
        if index < question_count - 2:
            item = _choice_question(f"q{index + 1}", f"题目{index + 1}")
            qualified_id = f"数学/模拟/q{index + 1}"
        else:
            member_index = index - (question_count - 2) + 1
            item = QuestionItem(
                id=f"g__{member_index:02d}",
                type="fill",
                content=f"材料题小问{member_index}。",
                answer=f"答案{member_index}",
                analysis=f"解析组{member_index}",
                group_material="共享材料文字。",
                unified=False,
                group_root_id="g",
                group_member_index=member_index,
            )
            qualified_id = "数学/模拟/g"
        questions.append(
            HydratedQuestion(qualified_id=qualified_id, item=item, item_score=2.0)
        )

    return HydratedExam(
        exam_id="render-sample",
        metadata={
            "title": "双份渲染验收",
            "subject": "数学",
            "total_score": 40,
            "duration_minutes": 45,
        },
        sections=[
            HydratedSection(
                section_id="空白选择",
                type="single_choice",
                score_per_item=2.0,
                questions=[],
                describe="空节",
            ),
            HydratedSection(
                section_id="选择与题组",
                type="single_choice",
                score_per_item=2.0,
                questions=questions,
                describe="混合题型",
            ),
        ],
    )


def test_write_student_teacher_matches_independent_render_and_group_numbering(
    tmp_path: Path,
) -> None:
    hydrated = _sample_exam()
    template_dir = Path(render_module.__file__).parents[1] / "templates" / "latex"
    expected_student_path = tmp_path / "expected-student.tex"
    expected_teacher_path = tmp_path / "expected-teacher.tex"
    expected_student_path.write_text(
        render_module.render_tex(
            hydrated, template_dir, "GaokaoMath.tex.j2", show_answers=False
        ),
        encoding="utf-8",
    )
    expected_teacher_path.write_text(
        render_module.render_tex(
            hydrated, template_dir, "GaokaoMath.tex.j2", show_answers=True
        ),
        encoding="utf-8",
    )
    expected_student = expected_student_path.read_bytes()
    expected_teacher = expected_teacher_path.read_bytes()

    student_path, teacher_path = render_module.write_student_teacher_tex(
        hydrated,
        template_dir,
        "GaokaoMath.tex.j2",
        tmp_path,
        LoadedQuestions(),
    )

    student = student_path.read_bytes()
    teacher = teacher_path.read_bytes()
    assert student == expected_student
    assert teacher == expected_teacher
    assert b"\xe7\xad\x94\xe6\xa1\x88" not in student
    assert "答案1" in teacher.decode("utf-8")
    assert r"\section*{空白选择}" in student.decode("utf-8")
    assert "18.1" in student.decode("utf-8")
    assert "18.2" in student.decode("utf-8")


def test_custom_template_mutations_do_not_leak_between_student_and_teacher(
    tmp_path: Path,
) -> None:
    template = tmp_path / "mutating.tex.j2"
    template.write_text(
        "[[ sections.pop(0).questions.pop(0).options.update({'A': 'changed'}) ]]\n"
        "[[ sections[0].questions[0].options.pop('B') ]]\n"
        "[[ show_answers ]]\n",
        encoding="utf-8",
    )
    first = _choice_question("first", "第一题")
    second = _choice_question("second", "第二题")
    hydrated = HydratedExam(
        exam_id="custom-template",
        metadata={"title": "模板副作用"},
        sections=[
            HydratedSection(
                "First",
                "single_choice",
                1.0,
                [HydratedQuestion("校/库/first", first, 1.0)],
            ),
            HydratedSection(
                "Second",
                "single_choice",
                1.0,
                [HydratedQuestion("校/库/second", second, 1.0)],
            ),
        ],
    )

    student_path, teacher_path = render_module.write_student_teacher_tex(
        hydrated, tmp_path, template.name, tmp_path / "out", LoadedQuestions()
    )

    assert student_path.read_text(encoding="utf-8") == "None\n选项乙\nFalse"
    assert teacher_path.read_text(encoding="utf-8") == "None\n选项乙\nTrue"
    assert first.options == {"B": "选项乙", "A": "选项甲"}
    assert second.options == {"B": "选项乙", "A": "选项甲"}


def test_template_updates_and_project_search_paths_are_fresh_per_render(
    tmp_path: Path,
) -> None:
    first_project = tmp_path / "project-one"
    second_project = tmp_path / "project-two"
    first_project.mkdir()
    second_project.mkdir()
    template_name = "SameName.tex.j2"
    first_template = first_project / template_name
    second_template = second_project / template_name
    first_template.write_text("project-one-v1", encoding="utf-8")
    second_template.write_text("project-two", encoding="utf-8")
    hydrated = _sample_exam(question_count=0)

    def render_from(project: Path) -> str:
        return render_module.render_tex(
            hydrated, project, template_name, show_answers=False
        )

    assert render_from(first_project) == "project-one-v1"
    first_template.write_text("project-one-v2", encoding="utf-8")
    assert render_from(second_project) == "project-two"
    assert render_from(first_project) == "project-one-v2"


def test_each_dual_export_prepares_one_template_without_cross_call_cache(
    tmp_path: Path,
    monkeypatch,
) -> None:
    template = tmp_path / "Changing.tex.j2"
    template.write_text("version-one:[[ show_answers ]]", encoding="utf-8")
    original = render_module._jinja_env
    calls = 0

    def count_environment(loader_dirs):
        nonlocal calls
        calls += 1
        return original(loader_dirs)

    monkeypatch.setattr(render_module, "_jinja_env", count_environment)
    hydrated = _sample_exam(question_count=0)

    render_module.write_student_teacher_tex(
        hydrated, tmp_path, template.name, tmp_path / "first", LoadedQuestions()
    )
    assert calls == 1

    template.write_text("version-two:[[ show_answers ]]", encoding="utf-8")
    student_path, teacher_path = render_module.write_student_teacher_tex(
        hydrated, tmp_path, template.name, tmp_path / "second", LoadedQuestions()
    )
    assert calls == 2
    assert student_path.read_text(encoding="utf-8") == "version-two:False"
    assert teacher_path.read_text(encoding="utf-8") == "version-two:True"
