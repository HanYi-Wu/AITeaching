"""Explicit student class transfers for school administrators."""

from __future__ import annotations

import json
from contextlib import closing
from pathlib import Path
from typing import Any

from solaire.web.auth_service import utc_now
from solaire.web.papers.class_snapshots import freeze_legacy_student_class_memberships
from solaire.web.platform_db import connect, init_platform_db
from solaire.web.school.common import _new_id


class StudentClassTransferNotFound(Exception):
    """The student or target class is outside the requested school scope."""


class StudentClassTransferConflict(Exception):
    """The expected current class set is stale."""


class StudentClassTransferForbidden(Exception):
    """The actor is not an active administrator for this school."""


class StudentClassTransferDataError(ValueError):
    """Existing membership data cannot be safely shown or changed."""


def _require_active_school(con: Any, school_id: str) -> None:
    row = con.execute(
        "SELECT 1 FROM schools WHERE id = ? AND status = 'active'",
        (school_id,),
    ).fetchone()
    if row is None:
        raise StudentClassTransferNotFound("学校不存在或已停用")


def _require_student(con: Any, *, school_id: str, student_id: str) -> dict[str, Any]:
    row = con.execute(
        "SELECT id, school_id, student_no, display_name FROM students WHERE id = ? AND school_id = ?",
        (student_id, school_id),
    ).fetchone()
    if row is None:
        raise StudentClassTransferNotFound("学生不存在或不属于当前学校")
    return dict(row)


def _require_school_actor(con: Any, *, school_id: str, actor_id: str) -> None:
    row = con.execute(
        """SELECT 1 FROM users
           WHERE id = ? AND school_id = ? AND role = 'school' AND status = 'active'""",
        (actor_id, school_id),
    ).fetchone()
    if row is None:
        raise StudentClassTransferForbidden("仅本校有效的学校管理员可以执行转班")


def _current_classes(con: Any, *, student_id: str, school_id: str) -> list[dict[str, Any]]:
    rows = con.execute(
        """SELECT cs.class_id AS id, c.name, c.grade, c.school_id
           FROM class_students cs LEFT JOIN classes c ON c.id = cs.class_id
           WHERE cs.student_id = ?
           ORDER BY c.name, cs.class_id""",
        (student_id,),
    ).fetchall()
    if any(row["school_id"] != school_id or row["name"] is None for row in rows):
        raise StudentClassTransferDataError(
            "学生班级关联数据不属于当前学校或已损坏，已拒绝转班"
        )
    return [
        {"id": str(row["id"]), "name": str(row["name"]), "grade": row["grade"]}
        for row in rows
    ]


def _attempt_counts(con: Any, *, student_id: str) -> tuple[int, int]:
    row = con.execute(
        """SELECT COUNT(*) AS attempt_count,
                  COALESCE(SUM(CASE WHEN class_membership_frozen = 0 THEN 1 ELSE 0 END), 0)
                    AS legacy_attempt_count
           FROM student_attempts WHERE student_id = ?""",
        (student_id,),
    ).fetchone()
    return int(row["attempt_count"]), int(row["legacy_attempt_count"])


def get_student_class_transfer_preview(
    root: Path,
    *,
    school_id: str,
    student_id: str,
) -> dict[str, Any]:
    """Return a same-school transfer preview without exposing foreign class labels."""
    init_platform_db(root)
    with closing(connect(root)) as con:
        con.execute("BEGIN")
        try:
            _require_active_school(con, school_id)
            student = _require_student(con, school_id=school_id, student_id=student_id)
            current_classes = _current_classes(con, student_id=student_id, school_id=school_id)
            rows = con.execute(
                """SELECT id, name, grade FROM classes
                   WHERE school_id = ? ORDER BY name, id""",
                (school_id,),
            ).fetchall()
            available_classes = [
                {"id": str(row["id"]), "name": str(row["name"]), "grade": row["grade"]}
                for row in rows
            ]
            attempt_count, legacy_attempt_count = _attempt_counts(con, student_id=student_id)
            con.commit()
        except BaseException:
            con.rollback()
            raise
    return {
        "student": {
            "id": str(student["id"]),
            "student_no": str(student["student_no"]),
            "display_name": str(student["display_name"]),
        },
        "current_classes": current_classes,
        "available_classes": available_classes,
        "attempt_count": attempt_count,
        "legacy_attempt_count": legacy_attempt_count,
    }


def transfer_student_class(
    root: Path,
    *,
    school_id: str,
    student_id: str,
    target_class_id: str,
    expected_class_ids: list[str],
    actor_id: str,
) -> dict[str, Any]:
    """Transfer one student atomically, freezing currently visible history first."""
    init_platform_db(root)
    clean_target_id = target_class_id.strip()
    expected_ids = {str(class_id).strip() for class_id in expected_class_ids}
    if not clean_target_id:
        raise ValueError("目标班级不能为空")

    with closing(connect(root)) as con:
        con.execute("BEGIN IMMEDIATE")
        try:
            _require_active_school(con, school_id)
            _require_school_actor(con, school_id=school_id, actor_id=actor_id)
            student = _require_student(con, school_id=school_id, student_id=student_id)
            target_row = con.execute(
                "SELECT id, name, grade, school_id FROM classes WHERE id = ? AND school_id = ?",
                (clean_target_id, school_id),
            ).fetchone()
            if target_row is None:
                raise StudentClassTransferNotFound("目标班级不存在或不属于当前学校")
            target_class = {
                "id": str(target_row["id"]),
                "name": str(target_row["name"]),
                "grade": target_row["grade"],
            }
            previous_classes = _current_classes(con, student_id=student_id, school_id=school_id)
            current_ids = {str(item["id"]) for item in previous_classes}
            if expected_ids != current_ids:
                raise StudentClassTransferConflict("学生班级信息已变化，请刷新后重试")

            attempt_count, _legacy_attempt_count = _attempt_counts(con, student_id=student_id)
            if len(previous_classes) == 1 and current_ids == {clean_target_id}:
                con.commit()
                return {
                    "student_id": str(student["id"]),
                    "current_class": target_class,
                    "previous_classes": [],
                    "retained_attempt_count": attempt_count,
                    "captured_legacy_attempt_count": 0,
                    "changed": False,
                }

            transferred_at = utc_now()
            captured_legacy_attempt_count = freeze_legacy_student_class_memberships(
                con,
                student_id,
                captured_at=transferred_at,
            )
            con.execute("DELETE FROM class_students WHERE student_id = ?", (student_id,))
            con.execute(
                "INSERT INTO class_students (class_id, student_id) VALUES (?, ?)",
                (clean_target_id, student_id),
            )
            transfer_id = _new_id()
            con.execute(
                """INSERT INTO student_class_transfers (
                     id, school_id, student_id, actor_id, from_classes_json,
                     to_class_id, to_class_name, transferred_at,
                     retained_attempt_count, captured_legacy_attempt_count
                   ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    transfer_id,
                    school_id,
                    student_id,
                    actor_id,
                    json.dumps(previous_classes, ensure_ascii=False, separators=(",", ":")),
                    clean_target_id,
                    target_class["name"],
                    transferred_at,
                    attempt_count,
                    int(captured_legacy_attempt_count),
                ),
            )
            con.commit()
        except BaseException:
            con.rollback()
            raise

    return {
        "student_id": str(student["id"]),
        "current_class": target_class,
        "previous_classes": previous_classes,
        "retained_attempt_count": attempt_count,
        "captured_legacy_attempt_count": int(captured_legacy_attempt_count),
        "changed": True,
        "transfer_id": transfer_id,
    }
