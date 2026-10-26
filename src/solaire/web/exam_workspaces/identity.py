"""Exam workspace identity normalization and document structuring."""

from __future__ import annotations

from datetime import datetime, timezone
import re
from typing import Any, Literal

from solaire.exam_compiler.facade import SelectedSection
from solaire.web.draft_service import _section_dump
from solaire.web.exam_workspaces.paths import _norm_template_path_rel, _split_exam_path

ExamStatus = Literal["draft", "exported"]

_WIN_FORBIDDEN = frozenset('<>:"/\\|?*')
# Windows 保留设备名（不含扩展名时）
_WIN_RESERVED_NAMES = frozenset(
    {"CON", "PRN", "AUX", "NUL", *{f"COM{i}" for i in range(1, 10)}, *{f"LPT{i}" for i in range(1, 10)}}
)


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _norm_label(s: str) -> str:
    return " ".join((s or "").strip().split())


def label_subject_pair(export_label: str, subject: str) -> tuple[str, str]:
    return (_norm_label(export_label), _norm_label(subject))


def _identity_nonempty(pair: tuple[str, str]) -> bool:
    return bool(pair[0]) and bool(pair[1])


def _same_identity(a: tuple[str, str], b: tuple[str, str]) -> bool:
    if not _identity_nonempty(a) or not _identity_nonempty(b):
        return False
    return a == b


def _safe_fs_segment(normalized_text: str, *, field_name: str) -> str:
    """
    将已规范化的标签/学科文本转为单层目录名。
    若含 Windows 非法字符或规范化后不可用，抛出 ValueError（业务化提示）。
    """
    s = normalized_text.strip()
    if not s:
        raise ValueError(f"{field_name}不能为空。")
    out: list[str] = []
    for ch in s:
        if ch in _WIN_FORBIDDEN or ord(ch) < 32:
            out.append("－")
        else:
            out.append(ch)
    seg = "".join(out).strip()
    # 去掉末尾点与空格（Windows 不允许）
    seg = seg.rstrip(" .")
    seg = re.sub(r"[\s.]+$", "", seg)
    if not seg:
        raise ValueError(f"{field_name}在去除不可用符号后为空，请调整后再试。")
    if len(seg) > 120:
        raise ValueError(f"{field_name}过长，请缩短后再试（目录名最多 120 个字符）。")
    upper = seg.upper()
    if upper in _WIN_RESERVED_NAMES or upper.split(".")[0].upper() in _WIN_RESERVED_NAMES:
        raise ValueError(f"{field_name}「{seg}」不可用（与系统保留名称冲突），请调整后再试。")
    return seg


def segments_for_identity(export_label: str, subject: str) -> tuple[str, str]:
    """由「试卷说明 + 学科」得到两级目录名；非法则抛出 ValueError。"""
    el, sub = label_subject_pair(export_label, subject)
    if not _identity_nonempty((el, sub)):
        raise ValueError("请填写试卷说明与学科。")
    return (
        _safe_fs_segment(el, field_name="试卷说明"),
        _safe_fs_segment(sub, field_name="学科"),
    )


def exam_id_from_labels(export_label: str, subject: str) -> str:
    a, b = segments_for_identity(export_label, subject)
    return f"{a}/{b}"


def _safe_exam_id(exam_id: str) -> str:
    """校验并规范化 ``标签段/学科段`` 形式的 exam_id。"""
    a, b = _split_exam_path(exam_id)
    if not a or not b:
        raise ValueError("无效的考试标识")
    return f"{a}/{b}"


def _fill_identity_from_exam_path_fields(doc: dict[str, Any], eid: str) -> None:
    """当 YAML 中缺少试卷说明或学科时，用目录 ``exams/<标签段>/<学科段>/`` 回填。"""
    try:
        label_seg, subject_seg = _split_exam_path(eid)
    except ValueError:
        return
    if not str(doc.get("export_label") or "").strip():
        doc["export_label"] = label_seg
    if not str(doc.get("subject") or "").strip():
        doc["subject"] = subject_seg


def _build_exam_doc(
    *,
    exam_id: str,
    name: str,
    subject: str,
    export_label: str,
    template_ref: str,
    template_path: str,
    selected_items: list[SelectedSection],
    created_at: str,
    updated_at: str,
    source_exam_id: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    tpl_rel = _norm_template_path_rel(template_path)
    doc: dict[str, Any] = {
        "exam_id": exam_id,
        "name": name,
        "subject": subject.strip(),
        "export_label": export_label.strip(),
        "template_ref": template_ref.strip(),
        "template_path": tpl_rel,
        "selected_items": [_section_dump(s) for s in selected_items],
        "created_at": created_at,
        "updated_at": updated_at,
    }
    if source_exam_id:
        doc["source_exam_id"] = source_exam_id
    if metadata:
        doc["metadata"] = dict(metadata)
    return doc
