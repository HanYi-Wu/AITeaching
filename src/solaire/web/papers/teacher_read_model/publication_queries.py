"""Batched publication statistics with the existing visibility policy."""
from __future__ import annotations

from contextlib import closing
from collections.abc import Callable, Sequence
from pathlib import Path
from typing import Any

from solaire.web.platform_db import connect


def batch_publication_stats(
    root: Path,
    paper_ids: Sequence[str],
    user: dict[str, Any],
    pub_access_clause_func: Callable[[dict[str, Any]], tuple[str, list[str]]],
) -> dict[str, dict[str, int]]:
    unique_ids = list(dict.fromkeys(paper_ids))
    if not unique_ids:
        return {}

    default_stats: dict[str, Any] = {
        "has_publication_history": False,
        "publication_count": 0,
        "published_class_count": 0,
        "total_student_count": 0,
        "submitted_student_count": 0,
        "in_progress_student_count": 0,
        "graded_student_count": 0,
        "published_student_count": 0,
    }
    result = {pid: dict(default_stats) for pid in unique_ids}

    access_clause, access_params = pub_access_clause_func(user)

    with closing(connect(root)) as con, con:
        # Chunk queries to respect SQLite variable limits
        chunk_size = 400
        for offset in range(0, len(unique_ids), chunk_size):
            chunk = unique_ids[offset : offset + chunk_size]
            placeholders = ",".join("?" for _ in chunk)

            history_rows = con.execute(
                f"SELECT DISTINCT paper_id FROM exam_publications WHERE paper_id IN ({placeholders})",
                chunk,
            ).fetchall()
            for row in history_rows:
                pid = str(row["paper_id"])
                if pid in result:
                    result[pid]["has_publication_history"] = True

            stats_rows = con.execute(
                f"""
                WITH visible_ep AS (
                  SELECT ep.id, ep.paper_id
                  FROM exam_publications ep
                  WHERE ep.paper_id IN ({placeholders})
                    AND ep.status <> 'revoked'
                    AND {access_clause}
                ), publication_counts AS (
                  SELECT paper_id, COUNT(*) AS publication_count
                  FROM visible_ep
                  GROUP BY paper_id
                ), class_counts AS (
                  SELECT visible_ep.paper_id,
                         COUNT(DISTINCT pc.class_id) AS published_class_count
                  FROM visible_ep
                  LEFT JOIN publication_classes pc ON pc.publication_id = visible_ep.id
                  GROUP BY visible_ep.paper_id
                ), attempt_counts AS (
                  SELECT visible_ep.paper_id,
                         COUNT(DISTINCT sa.id) AS total_student_count,
                         COUNT(DISTINCT CASE
                           WHEN sa.status IN ('submitted', 'completed') OR sa.submitted_at IS NOT NULL THEN sa.id
                         END) AS submitted_student_count,
                         COUNT(DISTINCT CASE
                           WHEN sa.status = 'in_progress' AND sa.submitted_at IS NULL THEN sa.id
                         END) AS in_progress_student_count,
                         COUNT(DISTINCT CASE WHEN sa.grading_completed_at IS NOT NULL THEN sa.id END) AS graded_student_count,
                         COUNT(DISTINCT CASE WHEN sa.grading_completed_at IS NOT NULL THEN sa.id END) AS published_student_count
                  FROM visible_ep
                  LEFT JOIN student_attempts sa ON sa.publication_id = visible_ep.id
                  GROUP BY visible_ep.paper_id
                )
                SELECT publication_counts.paper_id,
                       publication_counts.publication_count,
                       COALESCE(class_counts.published_class_count, 0) AS published_class_count,
                       COALESCE(attempt_counts.total_student_count, 0) AS total_student_count,
                       COALESCE(attempt_counts.submitted_student_count, 0) AS submitted_student_count,
                       COALESCE(attempt_counts.in_progress_student_count, 0) AS in_progress_student_count,
                       COALESCE(attempt_counts.graded_student_count, 0) AS graded_student_count,
                       COALESCE(attempt_counts.published_student_count, 0) AS published_student_count
                FROM publication_counts
                LEFT JOIN class_counts ON class_counts.paper_id = publication_counts.paper_id
                LEFT JOIN attempt_counts ON attempt_counts.paper_id = publication_counts.paper_id
                """,
                (*chunk, *access_params),
            ).fetchall()
            for row in stats_rows:
                pid = str(row["paper_id"])
                if pid in result:
                    result[pid].update(
                        {
                            "publication_count": int(row["publication_count"] or 0),
                            "published_class_count": int(row["published_class_count"] or 0),
                            "total_student_count": int(row["total_student_count"] or 0),
                            "submitted_student_count": int(row["submitted_student_count"] or 0),
                            "in_progress_student_count": int(row["in_progress_student_count"] or 0),
                            "graded_student_count": int(row["graded_student_count"] or 0),
                            "published_student_count": int(row["published_student_count"] or 0),
                        }
                    )
    return result
