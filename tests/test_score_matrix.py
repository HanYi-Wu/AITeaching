from __future__ import annotations

import csv
import math
from dataclasses import dataclass

from solaire.edu_analysis.score_matrix import compute_score_matrix


@dataclass
class _Question:
    question_id: str
    score_per_item: float
    section_idx: int
    question_in_section: int
    section_id: str = "section"

    def csv_header(self) -> str:
        return f"{self.section_idx}.{self.question_in_section}"


def test_score_matrix_keeps_each_students_ratios_and_edge_values() -> None:
    questions = [
        _Question("dup", 2.0, 1, 1),
        _Question("dup", 2.0, 1, 2),
        _Question("zero", 0.0, 1, 3),
        _Question("negative", -1.0, 1, 4),
        _Question("last", 1.0, 1, 5),
    ]
    raw = (
        "姓名,学号,1.1,1.2,1.3,1.4,1.5\n"
        "甲,a,1,0,4,-1,-0.0\n"
        "乙,b,0,2,5,-1,0.5\n"
        "丙,c,nan,1,6,1,1.5\n"
    )

    result = compute_score_matrix(raw, questions)

    assert [row["fuzzy_score"] for row in result.student_stats[:2]] == [0.1, 0.3]
    assert math.isnan(result.student_stats[2]["fuzzy_score"])
    assert result.question_stats[1]["avg_score_ratio"] == 0.5
    assert result.question_stats[2]["avg_score_ratio"] == 0.0
    assert result.question_stats[2]["error_rate"] is None
    assert result.question_stats[0]["answered_count"] == 3
    assert math.isnan(result.question_stats[0]["avg_raw_score"])

    ratios = [row["ratios"] for row in result.student_mastery_rows]
    assert ratios[0] == [0.5, 0.0, None, None, -0.0]
    assert math.copysign(1.0, ratios[0][4]) == -1.0
    assert ratios[1] == [0.0, 1.0, None, None, 0.5]
    assert math.isnan(ratios[2][0])
    assert ratios[2][2:4] == [None, None]
    assert result.question_stats[0]["question_id"] == result.question_stats[1]["question_id"]


def test_score_matrix_position_fallback_keeps_blank_row_offsets() -> None:
    questions = [_Question("a", 2.0, 1, 1), _Question("b", 4.0, 1, 2)]
    raw = "legacy-a,legacy-b\n1.5,3\n\n2,4\n"

    result = compute_score_matrix(raw, questions)

    assert result.question_csv_headers == ["1.1", "1.2"]
    assert [row["name"] for row in result.student_stats] == ["学生1", "学生3"]
    assert [row["ratios"] for row in result.student_mastery_rows] == [[0.75, 0.75], [1.0, 1.0]]


def test_score_matrix_preserves_empty_file_and_header_only_errors() -> None:
    question = [_Question("a", 1.0, 1, 1)]

    try:
        compute_score_matrix("", question)
    except IndexError as exc:
        assert str(exc) == "list index out of range"
    else:
        raise AssertionError("empty CSV should retain the previous header IndexError")

    try:
        compute_score_matrix("姓名,学号,1.1\n", question)
    except ValueError as exc:
        assert str(exc) == "No student data found"
    else:
        raise AssertionError("header-only CSV should report missing student data")


def test_score_matrix_gives_later_csv_parse_error_precedence() -> None:
    question = [_Question("a", 1.0, 1, 1)]
    old_limit = csv.field_size_limit()
    csv.field_size_limit(1024)
    try:
        raw = "姓名,学号,1.1\n只有姓名\n" + ("x" * 2048) + "\n"
        try:
            compute_score_matrix(raw, question)
        except csv.Error as exc:
            assert "field larger than field limit" in str(exc)
        else:
            raise AssertionError("CSV parser errors must precede earlier row processing errors")
    finally:
        csv.field_size_limit(old_limit)
