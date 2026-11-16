"""Exam workspace configuration and atomic document persistence."""

from __future__ import annotations

from collections.abc import Iterator
import json
from pathlib import Path
import shutil
from typing import Any

import yaml

from solaire.common.atomic_files import write_text_atomic
from solaire.common.security import assert_within_project
from solaire.web.exam_workspaces.identity import (
    ExamStatus,
    _fill_identity_from_exam_path_fields,
    _identity_nonempty,
    _safe_exam_id,
    _same_identity,
    _utc_now_iso,
    exam_id_from_labels,
    label_subject_pair,
)
from solaire.web.exam_workspaces.paths import (
    _exams_root,
    _norm_template_path_rel,
    config_json_path,
    exam_yaml_path,
    workspace_dir,
)


def _default_config(
    *,
    exam_id: str,
    status: ExamStatus,
    export_label: str,
    subject: str,
    display_name: str,
    source_exam_id: str | None,
    created_at: str,
    updated_at: str,
) -> dict[str, Any]:
    return {
        "exam_id": exam_id,
        "status": status,
        "exam_label": export_label,
        "subject": subject,
        "display_name": display_name,
        "source_exam_id": source_exam_id,
        "created_at": created_at,
        "updated_at": updated_at,
    }


def _read_config(project_root: Path, exam_id: str) -> dict[str, Any] | None:
    return _read_config_file(config_json_path(project_root, exam_id))


def _read_config_file(path: Path) -> dict[str, Any] | None:
    """Read an already-resolved config path using the regular config fallback policy."""
    p = path
    if not p.is_file():
        return None
    try:
        with p.open(encoding="utf-8") as f:
            raw = json.load(f)
        return raw if isinstance(raw, dict) else None
    except (OSError, json.JSONDecodeError):
        return None


def _workspace_read_paths(project_root: Path, exam_id: str) -> tuple[Path, Path]:
    """Resolve one guarded workspace directory for both read-only file paths."""
    directory = workspace_dir(project_root, exam_id)
    return directory / "config.json", directory / "exam.yaml"


def _iter_exam_workspace_dirs(
    exams_root: Path,
) -> Iterator[tuple[str, Path]]:
    """Yield two-level workspace ids and their discovered directory paths."""
    if not exams_root.is_dir():
        return
    for label_dir in exams_root.iterdir():
        if not label_dir.is_dir():
            continue
        for subject_dir in label_dir.iterdir():
            if subject_dir.is_dir():
                yield (
                    f"{label_dir.name}/{subject_dir.name}",
                    subject_dir,
                )


def _write_config(project_root: Path, exam_id: str, cfg: dict[str, Any]) -> None:
    p = config_json_path(project_root, exam_id)
    p.parent.mkdir(parents=True, exist_ok=True)
    write_text_atomic(p, json.dumps(cfg, ensure_ascii=False, indent=2))


def _write_exam_yaml(project_root: Path, doc: dict[str, Any]) -> None:
    eid = _safe_exam_id(str(doc.get("exam_id") or ""))
    if not eid:
        raise ValueError("exam_id required")
    path = exam_yaml_path(project_root, eid)
    assert_within_project(project_root, path)
    path.parent.mkdir(parents=True, exist_ok=True)
    to_store = {k: v for k, v in doc.items() if k != "draft_id"}
    write_text_atomic(path, yaml.safe_dump(to_store, allow_unicode=True, sort_keys=False))


def label_subject_taken(
    project_root: Path,
    export_label: str,
    subject: str,
    *,
    exclude_exam_id: str | None = None,
) -> bool:
    """True if another workspace already uses the same non-empty 试卷说明 + 学科."""
    want = label_subject_pair(export_label, subject)
    if not _identity_nonempty(want):
        return False
    excl = _safe_exam_id(exclude_exam_id) if exclude_exam_id else None
    root = _exams_root(project_root)
    target_dir = (root / exam_id_from_labels(export_label, subject)).resolve()
    for eid, subj_dir in _iter_exam_workspace_dirs(root):
        if excl and eid == excl:
            continue
        try:
            config_path, _ = _workspace_read_paths(project_root, eid)
            cfg = _read_config_file(config_path)
        except (PermissionError, ValueError):
            # 不读取其他教师的内容；仍保留其目录名，避免同名创建覆盖已有试卷。
            if subj_dir.resolve() == target_dir:
                return True
            continue
        if cfg:
            got = label_subject_pair(str(cfg.get("exam_label") or ""), str(cfg.get("subject") or ""))
        else:
            yp = subj_dir / "exam.yaml"
            if not yp.is_file():
                continue
            try:
                with yp.open(encoding="utf-8") as f:
                    raw = yaml.safe_load(f)
            except OSError:
                continue
            if not isinstance(raw, dict):
                continue
            got = label_subject_pair(str(raw.get("export_label") or ""), str(raw.get("subject") or ""))
        if _same_identity(want, got):
            return True
    return False


def assert_unique_exam_identity(
    project_root: Path,
    export_label: str,
    subject: str,
    *,
    exclude_exam_id: str | None = None,
) -> None:
    """若已存在相同的「试卷说明」与「学科」，抛出 ``ValueError``。"""
    if label_subject_taken(project_root, export_label, subject, exclude_exam_id=exclude_exam_id):
        raise ValueError("已存在相同的「试卷说明」与「学科」，请修改后再试。")


def load_exam_workspace(project_root: Path, exam_id: str) -> dict[str, Any]:
    """Load ``exam.yaml`` for the compose UI."""
    eid = _safe_exam_id(exam_id)
    path = exam_yaml_path(project_root, eid)
    assert_within_project(project_root, path)
    if not path.is_file():
        raise FileNotFoundError(f"考试工作区不存在：{exam_id}")
    with path.open(encoding="utf-8") as f:
        raw = yaml.safe_load(f)
    if not isinstance(raw, dict):
        raise ValueError("无效的考试工作区文件")
    doc = dict(raw)
    # 目录标识以路径为准（``exams/<标签>/<学科>/``），避免 YAML 内仍为历史单段 id 时污染前端与后续保存。
    doc["exam_id"] = eid
    tp = doc.get("template_path")
    if isinstance(tp, str):
        doc["template_path"] = _norm_template_path_rel(tp)
    _fill_identity_from_exam_path_fields(doc, eid)
    return doc


def delete_exam_workspace(project_root: Path, exam_id: str) -> None:
    """删除 ``exams/<标签>/<学科>/``。"""
    eid = _safe_exam_id(exam_id)
    d = workspace_dir(project_root, eid)
    assert_within_project(project_root, d)
    if d.is_dir():
        shutil.rmtree(d)


def persist_exam_document(project_root: Path, doc: dict[str, Any]) -> dict[str, Any]:
    """Write a full exam dict (e.g. from history copy) to disk."""
    exam_id = str(doc.get("exam_id") or "").strip()
    if not exam_id:
        raise ValueError("exam_id required")
    doc = dict(doc)
    doc.pop("draft_id", None)
    tp0 = doc.get("template_path")
    if isinstance(tp0, str):
        doc["template_path"] = _norm_template_path_rel(tp0)
    eid = _safe_exam_id(exam_id)
    doc["exam_id"] = eid
    pair = label_subject_pair(str(doc.get("export_label") or ""), str(doc.get("subject") or ""))
    if _identity_nonempty(pair):
        assert_unique_exam_identity(project_root, doc["export_label"], doc["subject"], exclude_exam_id=eid)
    now = _utc_now_iso()
    doc.setdefault("created_at", now)
    doc["updated_at"] = now
    _write_exam_yaml(project_root, doc)
    cfg = _read_config(project_root, eid) or {}
    status = cfg.get("status") if cfg.get("status") in ("draft", "exported") else "draft"
    src_ex = doc.get("source_exam_id") or cfg.get("source_exam_id")
    _write_config(
        project_root,
        eid,
        _default_config(
            exam_id=eid,
            status=status,
            export_label=str(doc.get("export_label") or ""),
            subject=str(doc.get("subject") or ""),
            display_name=str(doc.get("name") or eid),
            source_exam_id=str(src_ex) if src_ex else None,
            created_at=str(cfg.get("created_at") or doc["created_at"]),
            updated_at=now,
        ),
    )
    return doc


def mark_exported(project_root: Path, exam_id: str) -> None:
    """导出成功后：``status=exported``。"""
    eid = _safe_exam_id(exam_id)
    cfg = _read_config(project_root, eid) or {}
    yp = exam_yaml_path(project_root, eid)
    if yp.is_file():
        try:
            with yp.open(encoding="utf-8") as f:
                raw = yaml.safe_load(f)
            if isinstance(raw, dict):
                cfg.setdefault("exam_label", str(raw.get("export_label") or ""))
                cfg.setdefault("subject", str(raw.get("subject") or ""))
                cfg.setdefault("display_name", str(raw.get("name") or eid))
        except OSError:
            pass
    if not cfg.get("created_at"):
        cfg["created_at"] = _utc_now_iso()
    now = _utc_now_iso()
    cfg["exam_id"] = eid
    cfg["status"] = "exported"
    cfg["updated_at"] = now
    cfg.pop("last_export_result_id", None)
    for k in ("exam_label", "subject", "display_name", "source_exam_id"):
        if k not in cfg:
            cfg[k] = ""
    _write_config(project_root, eid, cfg)
    yp = exam_yaml_path(project_root, eid)
    if yp.is_file():
        try:
            with yp.open(encoding="utf-8") as f:
                raw = yaml.safe_load(f)
            if isinstance(raw, dict):
                raw["updated_at"] = now
                write_text_atomic(yp, yaml.safe_dump(
                    {k: v for k, v in raw.items() if k != "draft_id"},
                    allow_unicode=True, sort_keys=False,
                ))
        except OSError:
            pass
