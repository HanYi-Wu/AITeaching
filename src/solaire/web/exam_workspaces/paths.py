"""Exam workspace filesystem path and template resolution."""

from __future__ import annotations

from pathlib import Path

from solaire.common.security import assert_within_project
from solaire.exam_compiler.loaders.template_loader import load_template


def _norm_template_path_rel(s: str) -> str:
    """
    与 ``/api/templates`` 列表一致：相对项目根的路径，如 ``templates/foo.yaml``。
    exam.yaml 中可能存 ``../templates/foo.yaml``（相对考试目录），需去掉前导 ``../`` 才能与前端列表匹配。
    """
    t = (s or "").replace("\\", "/").strip()
    while t.startswith("../"):
        t = t[3:]
    return t.lstrip("/")


def resolve_template_under_project(
    project_root: Path, template_path: str, template_ref: str
) -> tuple[Path, str]:
    """
    解析项目根下的版式 YAML 路径。

    先使用 ``template_path``（相对项目根，经 `_norm_template_path_rel`）；若文件不存在且
    ``template_ref`` 非空，则在 ``templates/**/*.yaml`` 中按 ``template_id`` 匹配回退，
    避免历史 ``exam.yaml`` 中路径与重命名后的模板文件不一致。
    """
    rel0 = _norm_template_path_rel(template_path)
    cand = (project_root / rel0).resolve()
    assert_within_project(project_root, cand)
    if cand.is_file():
        return cand, rel0
    ref = (template_ref or "").strip()
    if not ref:
        return cand, rel0
    td = project_root / "templates"
    if not td.is_dir():
        return cand, rel0
    root_res = project_root.resolve()
    for p in sorted(td.rglob("*.yaml")):
        try:
            t = load_template(p)
        except Exception:
            continue
        if t.template_id == ref:
            pr = p.resolve()
            assert_within_project(project_root, pr)
            rel1 = pr.relative_to(root_res).as_posix()
            return pr, rel1
    return cand, rel0


def _split_exam_path(exam_id: str) -> tuple[str, str]:
    s = (exam_id or "").strip().replace("\\", "/")
    parts = [p for p in s.split("/") if p and p != "."]
    if len(parts) != 2:
        raise ValueError("无效的考试标识")
    a, b = parts[0], parts[1]
    if ".." in a or ".." in b:
        raise ValueError("无效的考试标识")
    return a, b


def _exams_root(project_root: Path) -> Path:
    d = project_root / "exams"
    d.mkdir(parents=True, exist_ok=True)
    return d


def workspace_dir(project_root: Path, exam_id: str) -> Path:
    a, b = _split_exam_path(exam_id)
    d = (_exams_root(project_root) / a / b).resolve()
    assert_within_project(project_root, d)
    return d


def exam_yaml_path(project_root: Path, exam_id: str) -> Path:
    return workspace_dir(project_root, exam_id) / "exam.yaml"


def config_json_path(project_root: Path, exam_id: str) -> Path:
    return workspace_dir(project_root, exam_id) / "config.json"
