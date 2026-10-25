"""Shared destination and ownership policy for UI and AI exports."""

from pathlib import Path

import yaml
from fastapi import HTTPException

from solaire.exam_compiler.facade import ExamConfig
from solaire.web.exam_workspace_service import exam_yaml_path
from solaire.web.security import assert_within_project


def resolve_overwrite_target(
    root: Path, exam_id: str, export_label: str, subject: str
) -> Path:
    """Return resolved ``exams/<标签>/<学科>/`` directory; raises HTTPException if invalid or metadata mismatch."""
    dest = exam_yaml_path(root, exam_id).parent.resolve()
    assert_within_project(root, dest)
    exam_yaml = dest / "exam.yaml"
    if not exam_yaml.is_file():
        raise HTTPException(status_code=400, detail="覆盖目标不存在或缺少试卷配置")
    try:
        with exam_yaml.open(encoding="utf-8") as f:
            raw = yaml.safe_load(f)
        exam = ExamConfig.model_validate(raw)
    except Exception as e:
        raise HTTPException(status_code=400, detail="无法读取已有试卷配置") from e
    meta = exam.metadata or {}
    if str(meta.get("export_label", "")).strip() != export_label.strip():
        raise HTTPException(status_code=400, detail="覆盖目标的试卷说明与当前不一致")
    if str(meta.get("subject", "")).strip() != subject.strip():
        raise HTTPException(status_code=400, detail="覆盖目标的学科与当前不一致")
    return dest


def assert_destination_owner(
    root: Path, dest_dir: Path, teacher_id: str | None
) -> None:
    """A teacher must not replace a colleague's exam with the same label/path."""
    if not teacher_id:
        return
    from solaire.web.platform_db import connect, default_platform_root

    try:
        exam_id = dest_dir.resolve().relative_to((root / "exams").resolve()).as_posix()
    except ValueError as exc:
        raise HTTPException(status_code=403, detail="导出目录必须位于试卷目录下") from exc
    with connect(default_platform_root()) as con:
        row = con.execute(
            "SELECT id, owner_teacher_id FROM paper_records WHERE exam_id=? COLLATE NOCASE", (exam_id,)
        ).fetchone()
        publishers = (
            {
                str(item[0])
                for item in con.execute(
                    "SELECT DISTINCT teacher_id FROM exam_publications WHERE paper_id=?",
                    (str(row["id"]),),
                )
            }
            if row is not None
            else set()
        )
    if (
        row is not None
        and row["owner_teacher_id"]
        and str(row["owner_teacher_id"]) != teacher_id
    ):
        raise HTTPException(
            status_code=403, detail="该试卷属于其他教师，请使用不同的试卷说明"
        )
    if publishers and publishers != {teacher_id}:
        raise HTTPException(
            status_code=403, detail="该试卷已有其他教师的发布记录，请使用不同的试卷说明"
        )
    existing = dest_dir / "exam.yaml"
    if existing.is_file():
        try:
            metadata = (yaml.safe_load(existing.read_text(encoding="utf-8")) or {}).get(
                "metadata"
            ) or {}
            previous_owner = str(metadata.get("owner_teacher_id") or "").strip()
        except (OSError, ValueError, AttributeError, yaml.YAMLError) as exc:
            raise HTTPException(
                status_code=400, detail="现有试卷归属信息无法读取，拒绝覆盖"
            ) from exc
        if previous_owner and previous_owner != teacher_id:
            raise HTTPException(
                status_code=403, detail="该试卷属于其他教师，请使用不同的试卷说明"
            )
