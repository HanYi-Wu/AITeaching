"""Exam workspaces under ``exams/<考试标签>/<学科>/`` — ``exam.yaml`` + ``config.json``."""

from __future__ import annotations

from contextlib import closing
from pathlib import Path
from typing import Any

import yaml

from solaire.common.security import assert_within_project
from solaire.web.draft_service import (
    _sections_from_raw,
    normalize_draft_name,
)
from solaire.web.exam_workspaces.identity import (
    ExamStatus,
    _WIN_FORBIDDEN,
    _WIN_RESERVED_NAMES,
    _build_exam_doc,
    _fill_identity_from_exam_path_fields,
    _identity_nonempty,
    _norm_label,
    _safe_exam_id,
    _safe_fs_segment,
    _same_identity,
    _utc_now_iso,
    exam_id_from_labels,
    label_subject_pair,
    segments_for_identity,
)
from solaire.web.exam_workspaces.paths import (
    _exams_root,
    _norm_template_path_rel,
    _split_exam_path,
    config_json_path,
    exam_yaml_path,
    resolve_template_under_project,
    workspace_dir,
)
from solaire.web.exam_workspaces.persistence import (
    _default_config,
    _read_config,
    _write_config,
    _write_exam_yaml,
    assert_unique_exam_identity,
    delete_exam_workspace,
    label_subject_taken,
    load_exam_workspace,
    mark_exported,
    persist_exam_document,
)

__all__ = [
    "ExamStatus",
    "_WIN_FORBIDDEN",
    "_WIN_RESERVED_NAMES",
    "_utc_now_iso",
    "_exams_root",
    "_norm_label",
    "_norm_template_path_rel",
    "resolve_template_under_project",
    "label_subject_pair",
    "_identity_nonempty",
    "_same_identity",
    "_safe_fs_segment",
    "segments_for_identity",
    "exam_id_from_labels",
    "_split_exam_path",
    "_fill_identity_from_exam_path_fields",
    "_safe_exam_id",
    "workspace_dir",
    "exam_yaml_path",
    "config_json_path",
    "_read_config",
    "_write_config",
    "_default_config",
    "assert_unique_exam_identity",
    "label_subject_taken",
    "list_exam_workspaces",
    "load_exam_workspace",
    "delete_exam_workspace",
    "_build_exam_doc",
    "save_exam_workspace",
    "_write_exam_yaml",
    "persist_exam_document",
    "exam_document_from_exam",
    "create_workspace_from_exam",
    "mark_exported",
    "save_exam_workspace_after_export_failure",
    "import_legacy_draft_yaml",
]


def list_exam_workspaces(project_root: Path) -> list[dict[str, Any]]:
    """Newest ``updated_at`` first."""
    from solaire.common.actor_context import actor
    from solaire.web.platform_db import connect, default_platform_root, platform_db_path

    user = actor.get()
    hidden = set()
    platform = default_platform_root()
    if user and user.get("role") == "teacher" and platform_db_path(platform).is_file():
        with closing(connect(platform)) as con, con:
            hidden = {
                str(row["exam_id"]).casefold()
                for row in con.execute(
                    "SELECT exam_id FROM paper_records WHERE owner_teacher_id IS NOT NULL AND owner_teacher_id != ?",
                    (str(user["id"]),),
                )
            }
    root = _exams_root(project_root)
    if not root.is_dir():
        return []
    rows: list[tuple[float, dict[str, Any]]] = []
    for label_dir in root.iterdir():
        if not label_dir.is_dir():
            continue
        for subj_dir in label_dir.iterdir():
            if not subj_dir.is_dir():
                continue
            eid = f"{label_dir.name}/{subj_dir.name}"
            if eid.casefold() in hidden:
                continue
            try:
                cfg = _read_config(project_root, eid)
                yp = exam_yaml_path(project_root, eid)
            except (PermissionError, ValueError):
                continue
            if not yp.is_file():
                continue
            try:
                mtime = yp.stat().st_mtime
                if cfg:
                    updated = str(cfg.get("updated_at") or "")
                    status = str(cfg.get("status") or "draft")
                    display = str(cfg.get("display_name") or eid)
                    el = str(cfg.get("exam_label") or "")
                    sub = str(cfg.get("subject") or "")
                else:
                    with yp.open(encoding="utf-8") as f:
                        raw = yaml.safe_load(f)
                    if not isinstance(raw, dict):
                        continue
                    updated = str(raw.get("updated_at") or "")
                    status = "draft"
                    display = str(raw.get("name") or eid)
                    el = str(raw.get("export_label") or "")
                    sub = str(raw.get("subject") or "")
                rows.append(
                    (
                        mtime,
                        {
                            "exam_id": eid,
                            "name": display,
                            "subject": sub,
                            "export_label": el,
                            "template_ref": None,
                            "template_path": None,
                            "updated_at": updated,
                            "has_pdf": any(subj_dir.glob("*.pdf")),
                            "has_docx": any(subj_dir.glob("*.docx")),
                            "status": status if status in ("draft", "exported") else "draft",
                        },
                    ),
                )
            except OSError:
                continue
    rows.sort(key=lambda x: x[0], reverse=True)
    out = [r[1] for r in rows]
    for row in out:
        _fill_identity_from_exam_path_fields(row, str(row["exam_id"]))
    for row in out:
        eid = row["exam_id"]
        yp = exam_yaml_path(project_root, eid)
        try:
            with yp.open(encoding="utf-8") as f:
                raw = yaml.safe_load(f)
            if isinstance(raw, dict):
                row["template_ref"] = raw.get("template_ref")
                tp = raw.get("template_path")
                if tp is None:
                    row["template_path"] = None
                else:
                    row["template_path"] = _norm_template_path_rel(str(tp))
        except OSError:
            pass
    return out


def save_exam_workspace(
    project_root: Path,
    *,
    exam_id: str | None,
    name: str | None,
    subject: str,
    export_label: str,
    template_ref: str,
    template_path: str,
    selected_items: list[dict[str, Any]],
) -> dict[str, Any]:
    """Create or update workspace; returns stored document."""
    tpl_rel = _norm_template_path_rel(template_path)
    sections = _sections_from_raw(selected_items)
    now = _utc_now_iso()

    explicit_raw = (name or "").strip()
    default_name = f"{export_label or '试卷'} · {subject or ''}".strip(" ·")
    if not default_name:
        default_name = "未命名试卷"
    if explicit_raw:
        final_name = normalize_draft_name(explicit_raw)
        if not final_name:
            final_name = default_name
    else:
        final_name = default_name

    if exam_id:
        eid = _safe_exam_id(exam_id)
        try:
            new_eid = exam_id_from_labels(export_label, subject)
        except ValueError as e:
            raise ValueError(str(e)) from e
        if new_eid != eid:
            pair = label_subject_pair(export_label, subject)
            if _identity_nonempty(pair):
                assert_unique_exam_identity(project_root, export_label, subject, exclude_exam_id=eid)
            old_dir = workspace_dir(project_root, eid)
            new_dir = workspace_dir(project_root, new_eid)
            if new_dir.resolve() != old_dir.resolve():
                new_dir.parent.mkdir(parents=True, exist_ok=True)
                if new_dir.exists():
                    raise ValueError("目标试卷目录已存在，请重新命名")
                try:
                    old_dir.rename(new_dir)
                except FileExistsError as exc:
                    raise ValueError("目标试卷目录已存在，请重新命名") from exc
            eid = new_eid

        wdir = workspace_dir(project_root, eid)
        yp = wdir / "exam.yaml"
        assert_within_project(project_root, yp)
        if not yp.is_file():
            raise FileNotFoundError(f"考试工作区不存在：{exam_id}")
        created = now
        cfg0 = _read_config(project_root, eid)
        with yp.open(encoding="utf-8") as f:
            old = yaml.safe_load(f)
        if isinstance(old, dict) and old.get("created_at"):
            created = str(old["created_at"])
        src_ex = old.get("source_exam_id") if isinstance(old, dict) else None
        if cfg0 and cfg0.get("source_exam_id"):
            src_ex = str(cfg0.get("source_exam_id"))
        pair = label_subject_pair(export_label, subject)
        if _identity_nonempty(pair):
            assert_unique_exam_identity(project_root, export_label, subject, exclude_exam_id=eid)
        meta = dict(old.get("metadata")) if isinstance(old, dict) and isinstance(old.get("metadata"), dict) else {}
        from solaire.common.actor_context import actor

        current_actor = actor.get()
        if current_actor and current_actor.get("role") == "teacher" and not meta.get("owner_teacher_id"):
            meta["owner_teacher_id"] = str(current_actor["id"])
        doc = _build_exam_doc(
            exam_id=eid,
            name=final_name,
            subject=subject,
            export_label=export_label,
            template_ref=template_ref,
            template_path=tpl_rel,
            selected_items=sections,
            created_at=created,
            updated_at=now,
            source_exam_id=str(src_ex) if src_ex else None,
            metadata=meta or None,
        )
        status: ExamStatus = "exported" if (cfg0 or {}).get("status") == "exported" else "draft"
        _write_exam_yaml(project_root, doc)
        _write_config(
            project_root,
            eid,
            _default_config(
                exam_id=eid,
                status=status,
                export_label=doc["export_label"],
                subject=doc["subject"],
                display_name=final_name,
                source_exam_id=str(src_ex) if src_ex else None,
                created_at=created,
                updated_at=now,
            ),
        )
        return doc

    pair = label_subject_pair(export_label, subject)
    if _identity_nonempty(pair):
        assert_unique_exam_identity(project_root, export_label, subject)
    try:
        new_id = exam_id_from_labels(export_label, subject)
    except ValueError as e:
        raise ValueError(str(e)) from e
    wdir = workspace_dir(project_root, new_id)
    wdir.mkdir(parents=True, exist_ok=True)
    new_meta: dict[str, Any] = {}
    from solaire.common.actor_context import actor

    current_actor = actor.get()
    if current_actor and current_actor.get("role") == "teacher":
        new_meta["owner_teacher_id"] = str(current_actor["id"])
    doc = _build_exam_doc(
        exam_id=new_id,
        name=final_name,
        subject=subject,
        export_label=export_label,
        template_ref=template_ref,
        template_path=tpl_rel,
        selected_items=sections,
        created_at=now,
        updated_at=now,
        metadata=new_meta or None,
    )
    _write_exam_yaml(project_root, doc)
    _write_config(
        project_root,
        new_id,
        _default_config(
            exam_id=new_id,
            status="draft",
            export_label=doc["export_label"],
            subject=doc["subject"],
            display_name=final_name,
            source_exam_id=None,
            created_at=now,
            updated_at=now,
        ),
    )
    return doc


def exam_document_from_exam(
    project_root: Path,
    source_exam_id: str,
    *,
    export_label: str,
) -> dict[str, Any]:
    """Build new workspace document from another ``exams/…/…/exam.yaml`` (not written)."""
    d = load_exam_workspace(project_root, source_exam_id)
    subject = str(d.get("subject") or "").strip()
    el = _norm_label(export_label)
    try:
        new_id = exam_id_from_labels(el, subject)
    except ValueError as e:
        raise ValueError(str(e)) from e
    display_name = f"{el} · {subject}".strip(" ·") if el or subject else "试卷"
    doc: dict[str, Any] = {
        "exam_id": new_id,
        "name": display_name,
        "subject": subject,
        "export_label": el,
        "template_ref": d.get("template_ref") or "",
        "template_path": d.get("template_path") or "",
        "selected_items": d.get("selected_items") or [],
        "created_at": d.get("created_at"),
        "updated_at": d.get("updated_at"),
        "source_exam_id": _safe_exam_id(source_exam_id),
    }
    return doc


def create_workspace_from_exam(
    project_root: Path,
    source_exam_id: str,
    *,
    export_label: str,
) -> dict[str, Any]:
    """Copy an existing exam folder into a new ``exams/<标签>/<学科>/`` directory。"""
    doc = exam_document_from_exam(project_root, source_exam_id, export_label=export_label)
    return persist_exam_document(project_root, doc)


def save_exam_workspace_after_export_failure(
    project_root: Path,
    *,
    template_ref: str,
    template_path: str,
    export_label: str,
    subject: str,
    selected_items: list[dict[str, Any]],
) -> dict[str, Any]:
    """导出失败时写入新的 ``exams/…/…/`` 草稿（试卷说明带「导出失败」后缀以避免冲突）。"""
    base = export_label.strip() or "试卷"
    candidates = [f"{base}（导出失败）"] + [f"{base}（导出失败{k}）" for k in range(2, 50)]
    for el in candidates:
        try:
            doc = save_exam_workspace(
                project_root,
                exam_id=None,
                name=None,
                subject=subject,
                export_label=el,
                template_ref=template_ref,
                template_path=template_path,
                selected_items=selected_items,
            )
        except ValueError:
            continue
        from solaire.web.export_cleanup import recovery_document

        doc = recovery_document(doc)
        _write_exam_yaml(project_root, doc)
        return doc
    raise ValueError("无法为导出失败快照分配唯一的试卷说明")


def import_legacy_draft_yaml(
    project_root: Path, draft_yaml: Path, *, suffix: str | None = None
) -> dict[str, Any]:
    """
    Import a single ``.solaire/drafts/*.yaml`` into ``exams/<标签>/<学科>/``.

    Used by migration; on label+subject conflict, append ``suffix`` to 试卷说明.
    """
    with draft_yaml.open(encoding="utf-8") as f:
        raw = yaml.safe_load(f)
    if not isinstance(raw, dict):
        raise ValueError("invalid draft yaml")
    from solaire.common.actor_context import actor

    metadata = dict(raw.get("metadata") or {}) if isinstance(raw.get("metadata"), dict) else {}
    user = actor.get()
    if user and user.get("role") == "teacher":
        previous_owner = str(metadata.get("owner_teacher_id") or "").strip()
        if previous_owner and previous_owner != str(user["id"]):
            raise PermissionError("无权迁移其他教师的草稿")
        metadata["owner_teacher_id"] = str(user["id"])
    export_label = str(raw.get("export_label") or "").strip()
    subject = str(raw.get("subject") or "").strip()
    if suffix:
        export_label = f"{export_label}{suffix}".strip() if export_label else suffix.strip()
    # resolve conflicts by mutating label
    n = 2
    while _identity_nonempty(label_subject_pair(export_label, subject)) and label_subject_taken(
        project_root, export_label, subject
    ):
        base = str(raw.get("export_label") or "试卷").strip() or "试卷"
        export_label = f"{base}（迁移{n}）"
        n += 1
    now = _utc_now_iso()
    created = str(raw.get("created_at") or now)
    try:
        new_id = exam_id_from_labels(export_label, subject)
    except ValueError:
        new_id = exam_id_from_labels(f"{export_label}（迁移）", subject or "科目")
    doc: dict[str, Any] = {
        "exam_id": new_id,
        "name": str(raw.get("name") or "未命名试卷"),
        "subject": subject,
        "export_label": export_label,
        "template_ref": str(raw.get("template_ref") or ""),
        "template_path": _norm_template_path_rel(str(raw.get("template_path") or "")),
        "selected_items": raw.get("selected_items") or [],
        "created_at": created,
        "updated_at": str(raw.get("updated_at") or now),
    }
    if metadata:
        doc["metadata"] = metadata
    workspace_dir(project_root, new_id).mkdir(parents=True, exist_ok=True)
    _write_exam_yaml(project_root, doc)
    _write_config(
        project_root,
        new_id,
        _default_config(
            exam_id=new_id,
            status="draft",
            export_label=doc["export_label"],
            subject=doc["subject"],
            display_name=doc["name"],
            source_exam_id=None,
            created_at=created,
            updated_at=now,
        ),
    )
    return {"exam_id": new_id, "from_file": draft_yaml.name}
