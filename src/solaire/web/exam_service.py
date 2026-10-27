"""Exam YAML assembly, validation, and PDF export helpers."""

from __future__ import annotations

import os
import shutil
from pathlib import Path
from typing import Any

import yaml

from solaire.exam_compiler.facade import (
    PreparedExam,
    prepare_exam,
    ExamConfig,
    ExamTemplate,
    LatexmkError,
    QuestionLibraryRef,
    SelectedSection,
    analyze_math_static_for_loaded,
    build_exam_docx,
    build_exam_pdfs,
    format_latexmk_failure_message,
    format_pandoc_failure_message,
    PandocError,
    load_template,
    precheck_exam_latex_build,
    resolve_template_yaml_path,
)
from solaire.exam_compiler.loaders.questions import LoadedQuestions
from solaire.common.security import assert_within_project as assert_content_path

from solaire.web.library_discovery import discover_question_library_refs
from solaire.web.project_layout import ensure_project_layout
from solaire.web.security import assert_within_project, safe_filename_component
from solaire.web.export_artifacts import export_staging, publish_export_files


def _load_exam_config(exam_yaml_path: Path) -> ExamConfig:
    with exam_yaml_path.open(encoding="utf-8") as f:
        raw = yaml.safe_load(f)
    exam = ExamConfig.model_validate(raw)
    if all(section.score_per_item is not None for section in exam.selected_items):
        return exam

    template_path: Path | None = None
    try:
        template_path = resolve_template_yaml_path(exam_yaml_path, exam)
    except FileNotFoundError:
        if exam.template_path:
            exams_root = next((parent for parent in exam_yaml_path.resolve().parents if parent.name == "exams"), None)
            if exams_root is not None:
                project_root = exams_root.parent
                relative = Path(exam.template_path.replace("\\", "/"))
                if not relative.is_absolute():
                    candidate = (project_root / relative).resolve()
                    try:
                        candidate.relative_to(project_root)
                    except ValueError:
                        candidate = Path()
                    if candidate.is_file():
                        template_path = candidate
    if template_path is None:
        return exam

    template = load_template(template_path)
    defaults = {section.section_id: section.score_per_item for section in template.sections}
    selected_items = [
        section
        if section.score_per_item is not None or section.section_id not in defaults
        else section.model_copy(update={"score_per_item": float(defaults[section.section_id])})
        for section in exam.selected_items
    ]
    return exam.model_copy(update={"selected_items": selected_items})


def _iter_exam_workspace_dirs(project_root: Path):
    """Yield (exam_id, dir_path, exam_yaml_path) for ``exams/<标签>/<学科>/`` that contain exam.yaml."""
    exams_root = (project_root / "exams").resolve()
    if not exams_root.is_dir():
        return
    assert_within_project(project_root, exams_root)
    for label_dir in sorted(exams_root.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True):
        if not label_dir.is_dir():
            continue
        for subj_dir in label_dir.iterdir():
            if not subj_dir.is_dir():
                continue
            ey = subj_dir / "exam.yaml"
            if ey.is_file():
                try:
                    assert_content_path(project_root, ey)
                except (PermissionError, ValueError):
                    continue
                eid = f"{label_dir.name}/{subj_dir.name}"
                yield eid, subj_dir, ey


LIST_PROBE_NAME = "list.yaml"
BUILD_EXAM_NAME = "build.yaml"
BUILD_BACKUP_NAME = "build.yaml.before_export"
VALIDATE_EXAM_NAME = "validate.yaml"


def snapshot_build_yaml_before_export(project_root: Path) -> Path | None:
    """
    若已存在 .solaire/build.yaml，则复制为 build.yaml.before_export（覆盖旧备份）。
    在写入新组卷配置前调用，以便导出失败时恢复上一版选题。
    """
    ensure_project_layout(project_root)
    sol = project_root / ".solaire"
    build = sol / BUILD_EXAM_NAME
    backup = sol / BUILD_BACKUP_NAME
    if not build.is_file():
        return None
    shutil.copy2(build, backup)
    return backup


def restore_build_yaml_from_backup(project_root: Path, backup: Path | None) -> None:
    """Restore the previous selection, including its absence before a first export."""
    sol = project_root / ".solaire"
    build = sol / BUILD_EXAM_NAME
    if backup is None:
        build.unlink(missing_ok=True)
        return
    if not backup.is_file():
        raise FileNotFoundError("导出前的选题备份不存在，无法恢复")
    shutil.copy2(backup, build)


def discard_build_yaml_backup(backup: Path | None) -> None:
    """导出成功后删除临时备份文件。"""
    if backup is not None and backup.is_file():
        backup.unlink()


def _is_missing_pdf_toolchain_message(msg: str) -> bool:
    """True when failure is due to latexmk/xelatex not installed or not on PATH."""
    lower = msg.lower()
    if "latexmk not found" in lower:
        return True
    if "xelatex" in lower and "not found" in lower:
        return True
    if "ensure latexmk is on path" in lower:
        return True
    if "install tex live" in lower or "install miktex" in lower:
        return True
    return False


def exam_export_error_detail_short(exc: Exception, *, max_len: int = 160) -> str:
    """HTTP 响应中的单行摘要；完整内容须写入服务端日志。"""
    msg = str(exc).strip().replace("\r\n", "\n")
    if _is_missing_pdf_toolchain_message(msg):
        return (
            "未检测到用于导出试卷的 PDF 排版组件。请先安装 MiKTeX 或 TeX Live，"
            "安装完成后重试导出；也可在组卷页使用「一键安装」尝试。"
        )
    first = msg.split("\n")[0].strip()
    if len(first) > max_len:
        first = first[:max_len] + "…"
    if not first:
        return "操作失败，请查看运行日志。"
    return first


def _exam_yaml_in_solaire(project_root: Path) -> Path:
    from solaire.common.actor_context import teacher_key
    key = teacher_key()
    name = f'bank-probe-{key}.yaml' if key else LIST_PROBE_NAME
    return project_root / ".solaire" / name


def ensure_probe_list_yaml(project_root: Path) -> Path:
    """Regenerate probe exam with discovered question_libraries (题集 / namespaces)."""
    ensure_project_layout(project_root)
    solaire = project_root / ".solaire"
    solaire.mkdir(parents=True, exist_ok=True)
    probe = _exam_yaml_in_solaire(project_root)
    refs = discover_question_library_refs(project_root)
    body: dict[str, Any] = {
        "exam_id": "_list",
        "template_ref": "_dummy",
        "question_libraries": [{"path": r["path"], "namespace": r["namespace"]} for r in refs],
        "selected_items": [],
    }
    with probe.open("w", encoding="utf-8") as f:
        yaml.safe_dump(body, f, allow_unicode=True, sort_keys=False)
    return probe


def template_path_for_exam_under_solaire(_project_root: Path, template_relative: str) -> str:
    """Relative path from .solaire/*.yaml to project templates file."""
    rel = template_relative.replace("\\", "/").strip("/")
    return f"../{rel}"


def write_exam_yaml(
    project_root: Path,
    *,
    yaml_basename: str,
    exam_id: str,
    template_ref: str,
    template_relative: str,
    metadata: dict[str, Any],
    selected_items: list[SelectedSection],
) -> Path:
    solaire = project_root / ".solaire"
    solaire.mkdir(parents=True, exist_ok=True)
    out = solaire / yaml_basename
    refs = discover_question_library_refs(project_root)
    libs = [QuestionLibraryRef(path=r["path"], namespace=r["namespace"]) for r in refs]
    exam = ExamConfig(
        exam_id=exam_id,
        template_ref=template_ref,
        metadata=metadata,
        question_libraries=libs,
        template_path=template_path_for_exam_under_solaire(project_root, template_relative),
        selected_items=selected_items,
    )
    raw = exam.model_dump(mode="json")
    with out.open("w", encoding="utf-8") as f:
        yaml.safe_dump(raw, f, allow_unicode=True, sort_keys=False)
    return out


def write_build_exam_yaml(
    project_root: Path,
    *,
    exam_id: str,
    template_ref: str,
    template_relative: str,
    metadata: dict[str, Any],
    selected_items: list[SelectedSection],
) -> Path:
    return write_exam_yaml(
        project_root,
        yaml_basename=BUILD_EXAM_NAME,
        exam_id=exam_id,
        template_ref=template_ref,
        template_relative=template_relative,
        metadata=metadata,
        selected_items=selected_items,
    )


def _template_path_relative_to_exam_file(project_root: Path, exam_yaml: Path, template_relative: str) -> str:
    """template_relative is relative to project root (e.g. templates/x.yaml)."""
    rel = template_relative.replace("\\", "/").strip("/")
    abs_tpl = (project_root / rel).resolve()
    assert_within_project(project_root, abs_tpl)
    return os.path.relpath(abs_tpl, exam_yaml.parent.resolve()).replace("\\", "/")


def _rewrite_exam_paths_for_copy(
    project_root: Path,
    source_exam_yaml: Path,
    dest_exam_yaml: Path,
    exam_data: ExamConfig,
) -> ExamConfig:
    """Rewrite paths when copying .solaire/build.yaml into exams/<label>/<subject>/exam.yaml."""
    source_parent = source_exam_yaml.resolve().parent
    dest_parent = dest_exam_yaml.resolve().parent
    for library in exam_data.question_libraries:
        raw = Path(library.path)
        absolute = raw.resolve() if raw.is_absolute() else (source_parent / raw).resolve()
        assert_within_project(project_root, absolute)
        library.path = os.path.relpath(absolute, dest_parent).replace("\\", "/")
    if exam_data.template_path:
        raw_template = Path(exam_data.template_path)
        absolute_template = (
            raw_template.resolve() if raw_template.is_absolute() else (source_parent / raw_template).resolve()
        )
        assert_within_project(project_root, absolute_template)
        exam_data.template_path = os.path.relpath(absolute_template, dest_parent).replace("\\", "/")
    return exam_data


def write_preview_exam_yaml(
    project_root: Path,
    preview_dir: Path,
    *,
    exam_id: str,
    template_ref: str,
    template_relative: str,
    metadata: dict[str, Any],
    selected_items: list[SelectedSection],
) -> Path:
    """Write exam.yaml under preview_dir; template_path is relative to that file."""
    preview_dir.mkdir(parents=True, exist_ok=True)
    out = preview_dir / "exam.yaml"
    refs = discover_question_library_refs(project_root)
    # discover_question_library_refs 的路径是相对于 project/.solaire/ 下 exam.yaml 的「../resource/…」；
    # 预览文件在 .solaire/previews/<id>/，不能复用同一相对串，否则会解析到 .solaire/previews/resource/…
    exam_parent = out.parent.resolve()
    libs: list[QuestionLibraryRef] = []
    for r in refs:
        abs_lib = (project_root / ".solaire" / r["path"]).resolve()
        assert_within_project(project_root, abs_lib)
        rel = os.path.relpath(abs_lib, exam_parent).replace("\\", "/")
        libs.append(QuestionLibraryRef(path=rel, namespace=r["namespace"]))
    tpl_rel = _template_path_relative_to_exam_file(project_root, out, template_relative)
    exam = ExamConfig(
        exam_id=exam_id,
        template_ref=template_ref,
        metadata=metadata,
        question_libraries=libs,
        template_path=tpl_rel,
        selected_items=selected_items,
    )
    raw = exam.model_dump(mode="json")
    with out.open("w", encoding="utf-8") as f:
        yaml.safe_dump(raw, f, allow_unicode=True, sort_keys=False)
    return out


def find_export_conflict(project_root: Path, export_label: str, subject: str) -> dict[str, Any]:
    """若 ``exams/`` 下已有相同试卷说明+学科的导出，返回其 exam_id（``标签段/学科段``）。"""
    label = export_label.strip()
    subj = subject.strip()
    for exam_id, _dir_path, exam_yaml_path in _iter_exam_workspace_dirs(project_root):
        try:
            exam = _load_exam_config(exam_yaml_path)
            meta = exam.metadata or {}
            if str(meta.get("export_label", "")).strip() == label and str(meta.get("subject", "")).strip() == subj:
                return {
                    "conflict": True,
                    "existing_exam_id": exam_id,
                    "existing_dir": exam_id,
                }
        except Exception:
            continue
    return {"conflict": False, "existing_exam_id": None, "existing_dir": None}


def load_exam_for_validation(exam_yaml: Path) -> tuple[ExamConfig, LoadedQuestions, ExamTemplate]:
    """Load exam YAML, questions, template; run structural validate_exam."""
    prepared = prepare_exam(exam_yaml)
    return prepared.exam, prepared.loaded, prepared.template


def run_validate(project_root: Path, exam_yaml: Path) -> PreparedExam:
    assert_within_project(project_root, exam_yaml)
    return prepare_exam(exam_yaml)


def run_latex_precheck(exam_yaml: Path, *, prepared: PreparedExam | None = None) -> tuple[bool, str | None]:
    """Full hydrate → TeX → latexmk; returns (True, None) or (False, user-facing excerpt)."""
    try:
        precheck_exam_latex_build(exam_yaml, **({"prepared": prepared} if prepared is not None else {}))
    except LatexmkError as e:
        return False, format_latexmk_failure_message(e)
    return True, None


def run_validate_with_checks(
    project_root: Path,
    exam_yaml: Path,
    *,
    include_latex_check: bool = False,
    include_math_static: bool = True,
) -> dict[str, Any]:
    """
    Structural validation plus optional LaTeX precheck and math delimiter static analysis.
    """
    assert_within_project(project_root, exam_yaml)
    prepared = prepare_exam(exam_yaml)
    out: dict[str, Any] = {
        "structure_ok": True,
        "latex_ok": None,
        "latex_error_excerpt": None,
        "math_warnings": [],
    }
    if include_math_static:
        out["math_warnings"] = analyze_math_static_for_loaded(prepared.loaded)
    if include_latex_check:
        ok, err = run_latex_precheck(exam_yaml, prepared=prepared)
        out["latex_ok"] = ok
        out["latex_error_excerpt"] = err
    return out


def export_pdfs(
    project_root: Path,
    *,
    exam_yaml: Path,
    export_label: str,
    subject: str,
    template: ExamTemplate | None = None,
    dest_dir: Path,
    prepared: PreparedExam | None = None,
) -> tuple[Path, str, str]:
    """Generate both PDFs before replacing the previous pair and exam metadata."""
    return _export_documents(
        project_root, exam_yaml=exam_yaml, export_label=export_label,
        subject=subject, template=template, dest_dir=dest_dir, format="pdf", prepared=prepared,
    )


def export_docx(
    project_root: Path,
    *,
    exam_yaml: Path,
    export_label: str,
    subject: str,
    template: ExamTemplate | None = None,
    dest_dir: Path,
    prepared: PreparedExam | None = None,
) -> tuple[Path, str, str]:
    """Generate both Word files before replacing the previous pair and metadata."""
    return _export_documents(
        project_root, exam_yaml=exam_yaml, export_label=export_label,
        subject=subject, template=template, dest_dir=dest_dir, format="docx", prepared=prepared,
    )


def _export_documents(
    project_root: Path,
    *,
    exam_yaml: Path,
    export_label: str,
    subject: str,
    template: ExamTemplate | None,
    dest_dir: Path,
    format: str,
    prepared: PreparedExam | None = None,
) -> tuple[Path, str, str]:
    assert_within_project(project_root, exam_yaml)
    if prepared is not None:
        prepared.check_source(exam_yaml)
        template = prepared.template
    dest = dest_dir.resolve()
    assert_within_project(project_root, dest)
    exams_root = (project_root / "exams").resolve()
    try:
        dest.relative_to(exams_root)
    except ValueError as exc:
        raise ValueError("导出目录必须位于 exams/ 下") from exc
    dest.mkdir(parents=True, exist_ok=True)
    stem = f"{safe_filename_component(export_label)}-{safe_filename_component(subject)}"
    student_name = f"{stem}-学生版.{format}"
    teacher_name = f"{stem}-教师版.{format}"

    with export_staging(dest) as stage:
        try:
            build_options = {"prepared": prepared} if prepared is not None else {}
            if format == "pdf":
                student, teacher, _warnings = build_exam_pdfs(exam_yaml, out_dir=stage, **build_options)
            else:
                student, teacher = build_exam_docx(exam_yaml, out_dir=stage, **build_options)
        except LatexmkError as exc:
            raise RuntimeError(format_latexmk_failure_message(exc)) from exc
        except PandocError as exc:
            raise RuntimeError(format_pandoc_failure_message(exc)) from exc
        files = {student_name: student, teacher_name: teacher}
        if exam_yaml.is_file():
            if prepared is not None:
                exam_data = prepared.exam.model_copy(deep=True)
            else:
                with exam_yaml.open(encoding="utf-8") as handle:
                    exam_data = ExamConfig.model_validate(yaml.safe_load(handle))
            if template is not None:
                section_scores = {s.section_id: s.score_per_item for s in template.sections}
                for section in exam_data.selected_items:
                    if section.score_per_item is None and section.section_id in section_scores:
                        section.score_per_item = section_scores[section.section_id]
            destination_yaml = dest / "exam.yaml"
            exam_data = _rewrite_exam_paths_for_copy(project_root, exam_yaml, destination_yaml, exam_data)
            staged_yaml = stage / "exam.yaml"
            staged_yaml.write_text(
                yaml.safe_dump(exam_data.model_dump(mode="json"), allow_unicode=True, sort_keys=False),
                encoding="utf-8",
            )
            files["exam.yaml"] = staged_yaml
        for name in files:
            assert_within_project(project_root, dest / name)
        publish_export_files(dest, stage, files)

    # Remove obsolete generated variants only after the complete replacement succeeded.
    # Other formats, user documents and score data remain intact.
    for previous in dest.glob(f"*.{format}"):
        if previous.name in {student_name, teacher_name}:
            continue
        if previous.name.endswith((f"-学生版.{format}", f"-教师版.{format}")) or previous.name in {
            f"student_paper.{format}", f"teacher_paper.{format}",
        }:
            try:
                previous.unlink()
            except OSError:
                pass
    return dest, student_name, teacher_name


def export_preview_pdfs(
    project_root: Path,
    *,
    exam_yaml: Path,
    export_label: str,
    subject: str,
) -> tuple[str, str, list[str]]:
    """
    Build relaxed preview PDFs in the same folder as exam_yaml (typically .solaire/previews/<id>/).
    Does not write under exams/. Returns localized PDF filenames and warning lines.
    """
    assert_within_project(project_root, exam_yaml)
    dest = exam_yaml.parent.resolve()
    try:
        student_pdf, teacher_pdf, warnings = build_exam_pdfs(
            exam_yaml, out_dir=dest, clean_workdir=True, preview_relaxed=True
        )
    except LatexmkError as e:
        raise RuntimeError(format_latexmk_failure_message(e)) from e

    stem = f"{safe_filename_component(export_label)}-{safe_filename_component(subject)}"
    s_name = f"{stem}-学生版.pdf"
    t_name = f"{stem}-教师版.pdf"
    s_new = dest / s_name
    t_new = dest / t_name
    shutil.move(str(student_pdf), s_new)
    shutil.move(str(teacher_pdf), t_new)
    return s_name, t_name, warnings
