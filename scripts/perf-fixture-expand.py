"""Expand the isolated demo fixture for browser performance validation.

This script only writes the data root selected by EH_DATA_ROOT and the content
root selected by SOLAIRE_PROJECT_ROOT. It deliberately creates deterministic,
synthetic records: 50 released student results with 20 questions each, 30
assigned not-started papers for the papers page, and a small non-empty teacher
knowledge graph. It never touches a user's normal application data root.

Run it with the release virtualenv and the same EH_DATA_ROOT/
SOLAIRE_PROJECT_ROOT values used by the local backend.
"""

from __future__ import annotations

import argparse
import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from uuid import uuid4

from solaire.common.actor_context import actor
from solaire.knowledge_forge import create_concept_nodes_batch, create_graph, list_concept_nodes, list_graphs
from solaire.web import state
from solaire.web.actor_scope import teacher_graph_root
from solaire.web.auth_service import utc_now
from solaire.web.platform_db import connect, default_platform_root, row_to_dict


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--results", type=int, default=50, help="released result records for demo_student")
    parser.add_argument("--questions", type=int, default=20, help="questions per synthetic record")
    parser.add_argument("--pending-papers", type=int, default=30, help="assigned not-started papers for the papers page")
    parser.add_argument("--graph-nodes", type=int, default=100, help="synthetic teacher graph nodes")
    return parser.parse_args()


def question_payload(question_count: int) -> tuple[list[dict[str, Any]], dict[str, str]]:
    questions: list[dict[str, Any]] = []
    answers: dict[str, str] = {}
    for index in range(1, question_count + 1):
        question_id = f"perf-fixture/q{index:02d}"
        questions.append(
            {
                "question_id": question_id,
                "header": f"性能复测题 {index}",
                "section_id": "Choice",
                "score_per_item": 5,
                "type": "single_choice",
                "content": f"性能复测示例题 {index}：下列哪项是演示答案？",
                "options": {"A": "选项 A", "B": "选项 B", "C": "选项 C", "D": "选项 D"},
                "analysis": "这是用于浏览器渲染容量验证的合成题目。",
            }
        )
        answers[question_id] = "B"
    return questions, answers


def synthetic_graph(project_root: Path, teacher: dict[str, Any], count: int) -> dict[str, Any]:
    graph_root = teacher_graph_root(project_root, teacher)
    token = actor.set(teacher)
    try:
        graphs = list_graphs(graph_root)
        slug = str(graphs[0]["slug"]) if graphs else create_graph(graph_root, "性能复测数学图谱", "perf-fixture")
        existing = list_concept_nodes(graph_root, graph=slug)
        existing_ids = {str(item.get("id")) for item in existing}
        wanted = [f"perf-fixture-node-{index:02d}" for index in range(1, max(1, count) + 1)]
        missing = [node_id for node_id in wanted if node_id not in existing_ids]
        if missing:
            nodes: list[dict[str, Any]] = []
            root_id = wanted[0]
            if root_id in missing:
                nodes.append(
                    {
                        "id": root_id,
                        "canonical_name": "性能复测数学根节点",
                        "node_kind": "concept",
                        "subject": "数学",
                        "level": "高中",
                        "description": "性能复测用的合成知识图谱根节点。",
                        "layout_x": 0,
                        "layout_y": 0,
                    }
                )
            for index, node_id in enumerate(missing, start=1):
                if node_id == root_id:
                    continue
                nodes.append(
                    {
                        "id": node_id,
                        "canonical_name": f"性能复测知识点 {index:02d}",
                        "node_kind": "concept" if index % 4 else "skill",
                        "subject": "数学",
                        "level": "高中",
                        "description": "用于图谱页面渲染容量验证的合成节点。",
                        "primary_parent_id": root_id,
                        "layout_x": float((index % 6) * 180),
                        "layout_y": float((index // 6) * 90 + 100),
                    }
                )
            if nodes:
                create_concept_nodes_batch(graph_root, nodes, graph=slug)
        return {"slug": slug, "nodeCount": len(list_concept_nodes(graph_root, graph=slug))}
    finally:
        actor.reset(token)


def expand_database(
    platform_root: Path,
    *,
    result_count: int,
    question_count: int,
    pending_paper_count: int,
) -> dict[str, Any]:
    questions, answer_keys = question_payload(question_count)
    question_json = json.dumps(questions, ensure_ascii=False, separators=(",", ":"))
    answer_key_json = json.dumps(answer_keys, ensure_ascii=False, separators=(",", ":"))
    now = datetime.now(UTC).replace(microsecond=0)
    now_text = now.isoformat()
    created_results = 0
    created_pending = 0
    with connect(platform_root) as con:
        teacher_row = con.execute("SELECT * FROM users WHERE username = 'demo_teacher'").fetchone()
        student_row = con.execute("SELECT * FROM students WHERE student_no = 'S001'").fetchone()
        paper_row = con.execute("SELECT * FROM paper_records WHERE exam_id = 'demo-online/Math' LIMIT 1").fetchone()
        if teacher_row is None or student_row is None or paper_row is None:
            raise RuntimeError("seed_demo_data must run before perf-fixture-expand.py")
        teacher = row_to_dict(teacher_row) or {}
        student = row_to_dict(student_row) or {}
        paper_id = str(paper_row["id"])
        teacher_id = str(teacher_row["id"])
        student_id = str(student_row["id"])

        for index in range(1, max(0, result_count) + 1):
            publication_id = f"perf-fixture-result-pub-{index:03d}"
            attempt_id = f"perf-fixture-result-attempt-{index:03d}"
            submitted_at = (now - timedelta(minutes=index)).isoformat()
            title = f"性能复测成绩 {index:03d}"
            con.execute(
                """
                INSERT OR IGNORE INTO exam_publications (
                  id, paper_id, teacher_id, title, description, subject,
                  show_results_immediately, submission_mode, recipient_scope,
                  status, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, 'Math', 1, 'online', 'student', 'published', ?, ?)
                """,
                (publication_id, paper_id, teacher_id, title, "性能验证用合成成绩", submitted_at, submitted_at),
            )
            before = con.total_changes
            con.execute(
                """
                INSERT OR IGNORE INTO student_attempts (
                  id, publication_id, student_id, status, started_at, submitted_at,
                  score, max_score, time_spent_seconds, question_payload_json,
                  answer_key_json, question_payload_version, grading_completed_at
                ) VALUES (?, ?, ?, 'submitted', ?, ?, ?, ?, ?, ?, ?, 3, ?)
                """,
                (
                    attempt_id,
                    publication_id,
                    student_id,
                    (now - timedelta(minutes=index, seconds=900)).isoformat(),
                    submitted_at,
                    float(question_count * 5 - (index % max(1, min(question_count, 5))) * 5),
                    float(question_count * 5),
                    300 + (index % 11) * 13,
                    question_json,
                    answer_key_json,
                    submitted_at,
                ),
            )
            if con.total_changes == before:
                continue
            created_results += 1
            wrong_index = index % max(1, question_count)
            for question_index, question in enumerate(questions):
                question_id = str(question["question_id"])
                correct = question_index != wrong_index
                con.execute(
                    """
                    INSERT INTO student_answers (
                      id, attempt_id, question_id, answer_payload, is_correct, score,
                      grading_status, responded_at
                    ) VALUES (?, ?, ?, ?, ?, ?, 'auto_scored', ?)
                    """,
                    (
                        f"perf-fixture-result-answer-{index:03d}-{question_index:02d}-{uuid4().hex[:8]}",
                        attempt_id,
                        question_id,
                        json.dumps({"answer": "B" if correct else "A"}, ensure_ascii=False),
                        1 if correct else 0,
                        5.0 if correct else 0.0,
                        submitted_at,
                    ),
                )

        for index in range(1, max(0, pending_paper_count) + 1):
            publication_id = f"perf-fixture-pending-pub-{index:03d}"
            attempt_id = f"perf-fixture-pending-attempt-{index:03d}"
            published_at = (now + timedelta(seconds=index)).isoformat()
            title = f"性能复测待答试卷 {index:03d}"
            con.execute(
                """
                INSERT OR IGNORE INTO exam_publications (
                  id, paper_id, teacher_id, title, description, subject,
                  show_results_immediately, submission_mode, recipient_scope,
                  status, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, 'Math', 1, 'online', 'student', 'published', ?, ?)
                """,
                (publication_id, paper_id, teacher_id, title, "性能验证用合成待答试卷", published_at, published_at),
            )
            before = con.total_changes
            con.execute(
                """
                INSERT OR IGNORE INTO student_attempts (
                  id, publication_id, student_id, status, score, max_score,
                  question_payload_json, answer_key_json, question_payload_version
                ) VALUES (?, ?, ?, 'not_started', NULL, ?, ?, ?, 3)
                """,
                (attempt_id, publication_id, student_id, float(question_count * 5), question_json, answer_key_json),
            )
            if con.total_changes != before:
                created_pending += 1

        con.commit()
        result_total = int(
            con.execute(
                """
                SELECT COUNT(*) FROM student_attempts sa
                JOIN exam_publications ep ON ep.id = sa.publication_id
                WHERE sa.student_id = ? AND sa.status = 'submitted' AND ep.id LIKE 'perf-fixture-result-pub-%'
                """,
                (student_id,),
            ).fetchone()[0]
        )
        pending_total = int(
            con.execute(
                """
                SELECT COUNT(*) FROM student_attempts sa
                JOIN exam_publications ep ON ep.id = sa.publication_id
                WHERE sa.student_id = ? AND sa.status = 'not_started' AND ep.id LIKE 'perf-fixture-pending-pub-%'
                """,
                (student_id,),
            ).fetchone()[0]
        )
        answer_total = int(
            con.execute(
                """
                SELECT COUNT(*) FROM student_answers sa
                JOIN student_attempts a ON a.id = sa.attempt_id
                WHERE a.student_id = ? AND a.id LIKE 'perf-fixture-result-attempt-%'
                """,
                (student_id,),
            ).fetchone()[0]
        )
    return {
        "student": str(student.get("student_no") or "S001"),
        "resultRecords": result_total,
        "pendingPaperRecords": pending_total,
        "questionsPerRecord": question_count,
        "answerRows": answer_total,
        "createdResultsThisRun": created_results,
        "createdPendingThisRun": created_pending,
        "updatedAt": now_text,
    }


def main() -> None:
    args = parse_args()
    platform_root = default_platform_root()
    project_root = state.default_content_root()
    with connect(platform_root) as con:
        teacher = row_to_dict(con.execute("SELECT * FROM users WHERE username = 'demo_teacher'").fetchone())
    if teacher is None:
        raise RuntimeError("demo_teacher not found; run seed_demo_data.py first")
    database = expand_database(
        platform_root,
        result_count=args.results,
        question_count=args.questions,
        pending_paper_count=args.pending_papers,
    )
    graph = synthetic_graph(project_root, teacher, args.graph_nodes)
    print(json.dumps({"platformRoot": str(platform_root), "projectRoot": str(project_root), "database": database, "graph": graph}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
