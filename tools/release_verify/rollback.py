"""Align cached paper subjects for the retained 1.6.7 reader while services are stopped."""

from __future__ import annotations

import argparse
from collections import defaultdict
import json
from pathlib import Path, PurePosixPath
import sqlite3

import yaml


class RollbackPreparationError(ValueError):
    pass


def prepare_rollback(project: Path, platform_root: Path, *, apply: bool = False) -> dict:
    """Plan or atomically apply cache alignment; never rewrite exams or record IDs."""
    project, platform_root = project.resolve(), platform_root.resolve()
    database = (platform_root / ".solaire" / "platform.db").resolve()
    if not database.is_relative_to(platform_root):
        raise RollbackPreparationError("Platform database resolves outside the supplied root")
    if not database.is_file():
        raise FileNotFoundError(f"Platform database does not exist: {database}")
    exams = (project / "exams").resolve()
    if not exams.is_relative_to(project):
        raise RollbackPreparationError("Exam directory resolves outside the supplied project")

    connection = sqlite3.connect(database.as_uri() + ("?mode=rw" if apply else "?mode=ro"), uri=True)
    connection.row_factory = sqlite3.Row
    try:
        connection.execute("PRAGMA foreign_keys = ON")
        if apply:
            connection.execute("BEGIN IMMEDIATE")
        groups = defaultdict(list)
        for row in connection.execute("SELECT id, exam_id, subject, owner_teacher_id FROM paper_records ORDER BY exam_id, id"):
            groups[str(row["exam_id"])].append(row)
        changes, skipped, inspected = [], [], []
        for exam_id, rows in groups.items():
            parts = PurePosixPath(exam_id.replace("\\", "/")).parts
            if len(parts) != 2 or any(part in {".", ".."} for part in parts):
                raise RollbackPreparationError(f"Invalid workspace identity: {exam_id}")
            path = (exams / parts[0] / parts[1] / "exam.yaml").resolve()
            if not path.is_relative_to(exams):
                raise RollbackPreparationError(f"Workspace resolves outside the project: {exam_id}")
            if not path.is_file():
                skipped.append(exam_id)
                continue
            if len(rows) != 1:
                raise RollbackPreparationError(f"Multiple paper records for {exam_id}; review them before rollback. No records were merged or deleted")
            content = path.read_bytes()
            document = yaml.safe_load(content)
            if not isinstance(document, dict):
                raise RollbackPreparationError(f"Invalid exam document: {exam_id}")
            metadata = document.get("metadata")
            if metadata is None:
                metadata = {}
            if not isinstance(metadata, dict):
                raise RollbackPreparationError(f"Invalid exam metadata: {exam_id}")
            row = rows[0]
            owner = str(metadata.get("owner_teacher_id") or "").strip()
            if owner and owner != str(row["owner_teacher_id"] or ""):
                raise RollbackPreparationError(f"Workspace owner conflicts with its paper record: {exam_id}")
            # 1.6.7 reads this metadata field, without the newer display fallback.
            subject = str(metadata.get("subject") or "").strip()
            subject = "通用" if not subject or subject == "未分科" else subject
            inspected.append((path, content))
            if subject != row["subject"]:
                changes.append({"paper_id": row["id"], "exam_id": exam_id, "previous_subject": row["subject"], "subject": subject})
        if apply:
            for path, content in inspected:
                if path.read_bytes() != content:
                    raise RollbackPreparationError(f"Workspace changed during preparation: {path}")
            for change in changes:
                updated = connection.execute(
                    "UPDATE paper_records SET subject=? WHERE id=? AND subject=?",
                    (change["subject"], change["paper_id"], change["previous_subject"]),
                )
                if updated.rowcount != 1:
                    raise RollbackPreparationError("Paper changed during rollback preparation")
            connection.commit()
        return {"applied": apply, "inspected_workspaces": len(inspected), "changes": changes, "skipped_missing_workspaces": skipped}
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", required=True, type=Path)
    parser.add_argument("--platform-root", required=True, type=Path)
    parser.add_argument("--apply", action="store_true", help="Apply after stopping the application; otherwise only print the plan")
    parser.add_argument("--output", type=Path)
    arguments = parser.parse_args()
    try:
        result = prepare_rollback(arguments.project, arguments.platform_root, apply=arguments.apply)
    except (RollbackPreparationError, OSError, sqlite3.Error, yaml.YAMLError) as exc:
        parser.exit(1, f"Rollback preparation failed: {exc}\n")
    document = json.dumps(result, ensure_ascii=False, indent=2)
    if arguments.output:
        arguments.output.write_text(document + "\n", encoding="utf-8")
    print(document)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
