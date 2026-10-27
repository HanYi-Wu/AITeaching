"""Conservative, repeatable repair for legacy exam ownership and attempt snapshots.

Dry run is the default. Applying writes a SQLite online backup first. Ambiguous
ownership and missing exam sources are reported, never guessed or fabricated.
"""

from __future__ import annotations

import argparse
import json
import sqlite3
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path

import yaml

from solaire.web.platform_db import default_platform_root, init_platform_db, platform_db_path
from solaire.web.student_service import _is_placeholder_question, _load_exam_question_payloads
from solaire.web.exam_workspace_service import exam_yaml_path


def repair(project_root: Path, platform_root: Path, *, apply: bool = False) -> dict:
    db = platform_db_path(platform_root)
    report: dict = {"database": str(db), "mode": "apply" if apply else "dry-run",
                    "backup": None, "owners_repaired": [], "attempts_repaired": [], "unresolved": []}
    if not db.is_file():
        report["unresolved"].append("平台数据库不存在；未创建新数据库")
        return report
    con = sqlite3.connect(db)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys=ON")
    try:
        if apply:
            backup_dir = db.parent / "repair-backups"
            backup_dir.mkdir(parents=True, exist_ok=True)
            backup = backup_dir / ("platform-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + ".db")
            suffix = 1
            while backup.exists():
                backup = backup_dir / f"platform-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}-{suffix}.db"
                suffix += 1
            with closing(sqlite3.connect(backup)) as target, target:
                con.backup(target)
            report["backup"] = str(backup)
            init_platform_db(platform_root)
        tables = {str(row[0]) for row in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        required = {"paper_records", "exam_publications", "student_attempts", "users", "student_answers"}
        if not required <= tables:
            report["unresolved"].append("旧数据库缺少必需表，请先运行平台数据库迁移")
            return report
        required_columns = {
            "paper_records": {"id", "exam_id", "owner_teacher_id", "school_id"},
            "student_attempts": {"id", "question_payload_json", "answer_key_json", "question_payload_version", "practice_metadata_json", "max_score"},
        }
        for table, columns in required_columns.items():
            present = {str(row[1]) for row in con.execute(f"PRAGMA table_info({table})")}
            if not columns <= present:
                report["unresolved"].append(f"{table} 缺少字段 {sorted(columns - present)}；请先运行平台数据库迁移")
                return report
        for paper in con.execute("SELECT * FROM paper_records").fetchall():
            paper_id = str(paper["id"])
            publishers = {str(row[0]) for row in con.execute(
                "SELECT DISTINCT teacher_id FROM exam_publications WHERE paper_id=?", (paper_id,))}
            source_owner = None
            try:
                source = yaml.safe_load(exam_yaml_path(project_root, str(paper["exam_id"])).read_text(encoding="utf-8"))
                source_owner = str((source.get("metadata") or {}).get("owner_teacher_id") or "").strip() or None
            except (OSError, ValueError, AttributeError, TypeError):
                pass
            candidates = publishers | ({source_owner} if source_owner else set())
            current = str(paper["owner_teacher_id"] or "").strip() or None
            if len(candidates) > 1:
                report["unresolved"].append(f"试卷 {paper_id} 有多个教师归属证据：{sorted(candidates)}；未修改")
                continue
            if not candidates:
                if not current:
                    report["unresolved"].append(f"试卷 {paper_id} 无可验证的教师归属；未修改")
                continue
            owner = next(iter(candidates))
            teacher = con.execute("SELECT school_id FROM users WHERE id=? AND role='teacher'", (owner,)).fetchone()
            if teacher is None:
                report["unresolved"].append(f"试卷 {paper_id} 的教师 {owner} 不存在；未修改")
                continue
            if current != owner or paper["school_id"] != teacher["school_id"]:
                report["owners_repaired"].append(paper_id)
                if apply:
                    con.execute("UPDATE paper_records SET owner_teacher_id=?, school_id=? WHERE id=?",
                                (owner, teacher["school_id"], paper_id))
        for attempt in con.execute("""SELECT sa.*, pr.exam_id FROM student_attempts sa
            JOIN exam_publications ep ON ep.id=sa.publication_id
            JOIN paper_records pr ON pr.id=ep.paper_id""").fetchall():
            attempt_id = str(attempt["id"])
            practice = str(attempt["practice_metadata_json"] or "").strip()
            if practice not in ("", "null", "{}"):
                continue  # Personalized snapshots cannot be reconstructed from a common exam.
            raw = attempt["question_payload_json"]
            try:
                questions = json.loads(raw) if raw else []
            except (TypeError, ValueError):
                questions = []
            if not isinstance(questions, list) or not all(isinstance(item, dict) for item in questions):
                report["unresolved"].append(f"答卷 {attempt_id} 的旧题目快照格式无效；未覆盖")
                continue
            version = int(attempt["question_payload_version"] or 1)
            has_placeholder = any(_is_placeholder_question(item) for item in questions)
            if questions and version >= 3 and not has_placeholder:
                continue  # Never rewrite a valid frozen snapshot.
            try:
                source_questions, source_answers = _load_exam_question_payloads(project_root, str(attempt["exam_id"]))
            except (OSError, ValueError) as exc:
                report["unresolved"].append(f"答卷 {attempt_id} 无法恢复题目：{exc}")
                continue
            if not source_questions:
                report["unresolved"].append(f"答卷 {attempt_id} 来源试卷没有题目；未伪造题目")
                continue
            source_by_id = {str(item["question_id"]): item for item in source_questions}
            source_ids = set(source_by_id)
            answered = {str(row[0]) for row in con.execute(
                "SELECT question_id FROM student_answers WHERE attempt_id=?", (attempt_id,))}
            frozen_ids = {str(item.get("question_id") or "") for item in questions}
            if not answered <= source_ids or (questions and not frozen_ids <= source_ids):
                report["unresolved"].append(f"答卷 {attempt_id} 已答题目与来源不一致；未覆盖")
                continue
            if questions:
                repaired_questions = []
                for item in questions:
                    qid = str(item["question_id"])
                    if _is_placeholder_question(item):
                        repaired = dict(source_by_id[qid])
                        for key in ("header", "section_id"):
                            if item.get(key) is not None:
                                repaired[key] = item[key]
                    else:
                        repaired = dict(item)
                        if version < 2:
                            repaired["score_per_item"] = source_by_id[qid].get("score_per_item")
                        if version < 3:
                            repaired["analysis"] = source_by_id[qid].get("analysis")
                    repaired_questions.append(repaired)
            else:
                repaired_questions = source_questions
            try:
                previous_answers = json.loads(attempt["answer_key_json"] or "{}")
                if not isinstance(previous_answers, dict):
                    raise ValueError()
            except (TypeError, ValueError):
                previous_answers = {}
            repaired_answers = {**source_answers, **previous_answers}
            report["attempts_repaired"].append(attempt_id)
            if apply:
                max_score = round(sum(float(item.get("score_per_item") or 0) for item in repaired_questions), 2)
                con.execute("""UPDATE student_attempts SET question_payload_json=?, answer_key_json=?,
                    question_payload_version=3, max_score=CASE WHEN max_score IS NULL OR max_score=0
                    THEN ? ELSE max_score END WHERE id=?""",
                    (json.dumps(repaired_questions, ensure_ascii=False),
                     json.dumps(repaired_answers, ensure_ascii=False), max_score, attempt_id))
        if apply:
            con.commit()
    finally:
        con.close()
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project-root", type=Path, required=True)
    parser.add_argument("--platform-root", type=Path, default=default_platform_root())
    parser.add_argument("--apply", action="store_true", help="备份数据库后应用可验证的修复")
    args = parser.parse_args()
    print(json.dumps(repair(args.project_root, args.platform_root, apply=args.apply), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
