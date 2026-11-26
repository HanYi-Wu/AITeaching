"""Personal teaching workload; never crosses paper or publisher ownership."""

from contextlib import closing
from pathlib import Path

from solaire.web.platform_db import connect


def teacher_workbench(root: Path, user: dict) -> dict:
    teacher_id = user.get("id")
    if user.get("role") != "teacher" or not teacher_id:
        raise PermissionError("此工作台仅限教师")
    with closing(connect(root)) as db:
        rows = db.execute("""
            WITH pending AS (
              SELECT pr.id AS paper_id, pr.title, sa.id AS attempt_id, sa.submitted_at,
                     COUNT(*) OVER (PARTITION BY pr.id) AS pending_count,
                     ROW_NUMBER() OVER (PARTITION BY pr.id ORDER BY sa.submitted_at, sa.id) AS item_number
              FROM exam_publications ep
              JOIN paper_records pr ON pr.id = ep.paper_id
              JOIN student_attempts sa ON sa.publication_id = ep.id
              WHERE ep.teacher_id = ? AND pr.owner_teacher_id = ? AND ep.status <> 'revoked'
                AND sa.grading_completed_at IS NULL
                AND (sa.status IN ('submitted', 'completed') OR sa.submitted_at IS NOT NULL)
            )
            SELECT paper_id, title, attempt_id, submitted_at, pending_count,
                   SUM(pending_count) OVER () AS pending_total, COUNT(*) OVER () AS paper_total
            FROM pending WHERE item_number = 1 ORDER BY submitted_at, paper_id LIMIT 8
        """, (teacher_id, teacher_id)).fetchall()
        remaining = db.execute("""
            SELECT COUNT(*) FROM exam_publications ep
            JOIN paper_records pr ON pr.id = ep.paper_id
            JOIN student_attempts sa ON sa.publication_id = ep.id
            WHERE ep.teacher_id = ? AND pr.owner_teacher_id = ? AND ep.status = 'published'
              AND (ep.start_at IS NULL OR julianday(ep.start_at) <= julianday('now'))
              AND (ep.end_at IS NULL OR julianday(ep.end_at) > julianday('now'))
              AND sa.submitted_at IS NULL AND sa.status IN ('not_started', 'in_progress')
        """, (teacher_id, teacher_id)).fetchone()[0]
    return {"pending_total": rows[0]["pending_total"] if rows else 0,
            "paper_total": rows[0]["paper_total"] if rows else 0, "outstanding_attempts": remaining,
            "queue": [{field: row[field] for field in ("paper_id", "title", "attempt_id", "submitted_at", "pending_count")}
                      for row in rows]}
