"""Score batch persistence, listing, import, and deletion."""

from __future__ import annotations

import csv
import io
import json
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from solaire.web.exam_service import _load_exam_config
from solaire.web.exam_workspace_service import workspace_dir
from solaire.web.results.models import (
    _flatten_questions,
    _now_utc,
    _safe_float,
)
from solaire.web.security import assert_within_project


def _list_score_batches(result_dir: Path) -> list[dict[str, Any]]:
    scores_dir = result_dir / "scores"
    if not scores_dir.is_dir():
        return []
    batches: list[dict[str, Any]] = []
    for bd in sorted(scores_dir.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True):
        if not bd.is_dir():
            continue
        scores_csv = bd / "scores.csv"
        analysis_json = bd / "analysis.json"
        mtime = datetime.fromtimestamp(bd.stat().st_mtime, tz=timezone.utc)
        student_count = 0
        question_count = 0
        if analysis_json.is_file():
            try:
                with analysis_json.open(encoding="utf-8") as f:
                    data = json.load(f)
                    student_count = data.get("student_count", 0)
                    question_count = data.get("question_count", 0)
            except Exception:
                pass
        elif scores_csv.is_file():
            try:
                with scores_csv.open(encoding="utf-8") as f:
                    reader = csv.reader(f)
                    rows = list(reader)
                    student_count = max(0, len(rows) - 1)  # subtract header
                    if rows:
                        question_count = max(0, len(rows[0]) - 2)
            except Exception:
                pass
        batches.append({
            "batch_id": bd.name,
            "imported_at": mtime.isoformat(),
            "student_count": student_count,
            "question_count": question_count,
        })
    return batches


def import_scores(
    project_root: Path,
    exam_id: str,
    file_bytes: bytes,
    filename: str,
) -> dict[str, Any]:
    """
    Parse uploaded CSV/Excel, validate, save to exams/.../scores/{batch_id}/.
    Returns batch summary + unbound question warnings.

    Only uses verifiable identities present in the imported file.
    Does not guess or merge similar or same-name students with platform accounts.
    """
    dir_path = workspace_dir(project_root, exam_id)
    assert_within_project(project_root, dir_path)

    exam_yaml = dir_path / "exam.yaml"
    if not exam_yaml.is_file():
        raise FileNotFoundError(f"exam.yaml not found for: {exam_id}")

    exam = _load_exam_config(exam_yaml)
    questions = _flatten_questions(exam)
    question_headers = [q.csv_header() for q in questions]

    # Parse CSV or Excel into row-based data
    raw_rows: list[list[str]]
    is_excel = filename.lower().endswith((".xlsx", ".xls"))
    if is_excel:
        try:
            import openpyxl
            from io import BytesIO as _BytesIO
            wb = openpyxl.load_workbook(_BytesIO(file_bytes))
            ws = wb.active
            raw_rows = [[str(v) if v is not None else "" for v in row] for row in ws.iter_rows(values_only=True)]
        except ImportError:
            raise ValueError("Excel 文件需要安装 openpyxl：pip install openpyxl") from None
    else:
        try:
            text = file_bytes.decode("utf-8-sig")  # handle BOM
        except UnicodeDecodeError:
            text = file_bytes.decode("gbk", errors="replace")
        reader = csv.reader(io.StringIO(text))
        raw_rows = list(reader)

    if len(raw_rows) < 2:
        raise ValueError("文件必须包含表头行和至少一行数据")

    header = [h.strip() for h in raw_rows[0]]
    data_rows = raw_rows[1:]

    # Build column index lookup
    # Primary: exact header match (after strip)
    header_to_idx: dict[str, int] = {h: i for i, h in enumerate(header)}
    # Score columns (non-name/id)
    score_col_indices: list[int] = [i for i, h in enumerate(header) if h not in ("姓名", "学号")]

    col_name = next((i for i, h in enumerate(header) if h.strip() == "姓名"), -1)
    col_id = next((i for i, h in enumerate(header) if h.strip() == "学号"), -1)

    # Missing header diagnostics
    missing_headers: list[str] = []
    for h in header:
        if h in ("姓名", "学号"):
            continue
        if h not in question_headers:
            # 部分匹配：允许列头有空格
            matched = [qh for qh in question_headers if qh == h.strip()]
            if not matched:
                missing_headers.append(h)

    # Parse students strictly using verbatim row fields
    students: list[dict[str, Any]] = []
    position_fallback_used = False
    for ri, row in enumerate(data_rows, start=2):
        if not row or all(not str(c).strip() for c in row):
            continue
        name = str(row[col_name]).strip() if col_name >= 0 and col_name < len(row) else f"学生{ri-1}"
        student_id = str(row[col_id]).strip() if col_id >= 0 and col_id < len(row) else ""

        scores: list[float | None] = []
        for qi, q in enumerate(questions):
            raw_score: str | None = None
            if q.csv_header() in header_to_idx:
                idx = header_to_idx[q.csv_header()]
                raw_score = str(row[idx]).strip() if idx < len(row) else None
            elif qi < len(score_col_indices):
                # Fallback: use positional match when header doesn't align exactly
                idx = score_col_indices[qi]
                raw_score = str(row[idx]).strip() if idx < len(row) else None
                position_fallback_used = True
            scores.append(_safe_float(raw_score))

        students.append({"name": name, "student_id": student_id, "scores": scores})

    if not students:
        raise ValueError("文件中没有找到有效学生数据")

    # Create batch dir
    batch_id = uuid.uuid4().hex
    scores_dir = dir_path / "scores" / batch_id
    scores_dir.mkdir(parents=True, exist_ok=True)

    # Save canonical CSV
    csv_path = scores_dir / "scores.csv"
    if is_excel:
        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerows(raw_rows)
        csv_text = buf.getvalue()
    else:
        try:
            csv_text = file_bytes.decode("utf-8-sig")
        except UnicodeDecodeError:
            csv_text = file_bytes.decode("gbk", errors="replace")
    with csv_path.open("w", encoding="utf-8", newline="") as f:
        f.write(csv_text)

    # Import warnings
    warnings: list[dict[str, str]] = []
    if missing_headers:
        warnings.append({
            "type": "missing_columns",
            "message": f"以下列头在模板中未找到：{', '.join(missing_headers)}，相关列的得分可能无法正确计算",
        })
    if position_fallback_used:
        warnings.append({
            "type": "position_fallback",
            "message": "部分列头与模板不完全匹配，已按列顺序映射。请检查得分是否对应正确的题目。",
        })

    # Save placeholder analysis (will be completed by compute_statistics)
    analysis_path = scores_dir / "analysis.json"
    placeholder: dict[str, Any] = {
        "batch_id": batch_id,
        "exam_id": exam_id,
        "student_count": len(students),
        "question_count": len(questions),
        "imported_at": _now_utc().isoformat(),
        "warnings": warnings,
        "question_stats": [],
        "node_stats": [],
        "student_stats": [],
    }
    with analysis_path.open("w", encoding="utf-8") as f:
        json.dump(placeholder, f, ensure_ascii=False, indent=2)

    return {
        "batch_id": batch_id,
        "student_count": len(students),
        "question_count": len(questions),
        "warnings": warnings,
        "missing_headers": missing_headers,
    }


def delete_score_batch(project_root: Path, exam_id: str, batch_id: str) -> dict[str, Any]:
    """Delete one imported score batch directory under exams/.../scores/{batch_id}."""
    exam_d = workspace_dir(project_root, exam_id)
    batch_dir = (exam_d / "scores" / batch_id).resolve()
    assert_within_project(project_root, batch_dir)
    if not batch_dir.is_dir():
        raise FileNotFoundError(f"Score batch not found: {batch_id}")
    shutil.rmtree(batch_dir)
    return {"ok": True, "exam_id": exam_id, "batch_id": batch_id}


def delete_exam_result(project_root: Path, exam_id: str) -> dict[str, Any]:
    """Delete one exam workspace under exams/<标签>/<学科>/（与组卷删除一致）。"""
    from solaire.web.exam_workspace_service import delete_exam_workspace

    delete_exam_workspace(project_root, exam_id)
    return {"ok": True, "exam_id": exam_id}
