"""Read-only orchestration for goal selection and duplicate reports."""

from __future__ import annotations

from collections import Counter
import math
from pathlib import Path
from typing import Any

from solaire.exam_compiler.loaders.template_loader import load_template
from solaire.web.auto_compose.catalog import Candidate, load_catalog, load_history
from solaire.web.auto_compose.selection import apportion, build_slots, choose_questions, matches_type
from solaire.web.auto_compose.similarity import check_duplicates, history_conflicts
from solaire.web.exam_workspaces.paths import resolve_template_under_project
from solaire.web.schemas.auto_compose import AutoComposeBody, DuplicateCheckBody

_DIFFICULTIES = ("easy", "medium", "hard", "unknown")


def _unique_warnings(values: list[str]) -> list[str]:
    return list(dict.fromkeys(values))


def compose_options(root: Path, subject: str | None = None) -> dict[str, Any]:
    bank, warnings = load_catalog(root)
    candidates = [item for item in bank if not subject or item.subject == subject.strip()]
    knowledge_counts = Counter(point for item in candidates for point in item.knowledge)
    names = {key: value for item in candidates for key, value in item.knowledge_names.items()}
    # Graph names also match as aliases; expose each binding once under its node ID.
    aliases = {value for key, value in names.items() if key != value}
    points = [point for point in knowledge_counts if point not in aliases or (
        point in names and names[point] != point)]
    difficulty_counts = Counter(item.difficulty for item in candidates)
    return {
        "total_count": len(candidates),
        "knowledge_points": sorted([
            {"id": point, "name": names.get(point, point), "question_count": knowledge_counts[point]}
            for point in points
        ], key=lambda item: (item["name"], item["id"])),
        "difficulty_counts": {key: difficulty_counts[key] for key in _DIFFICULTIES},
        "type_counts": dict(sorted(Counter(item.type for item in candidates).items())),
        "namespaces": sorted({item.namespace for item in candidates}),
        "warnings": warnings,
    }


def _duplicates(bank: list[Candidate], history: list[Candidate], ids: list[str],
                threshold: float, warnings: list[str]) -> dict[str, Any]:
    report = check_duplicates(ids, bank, history, threshold=threshold)
    report["warnings"] = _unique_warnings(warnings + report.get("warnings", []))
    report["complete"] = not bool(report["warnings"])
    return report


def check_paper_duplicates(root: Path, body: DuplicateCheckBody) -> dict[str, Any]:
    bank, warnings = load_catalog(root)
    # Validate against the actor's catalog before loading any historical data.
    known = {item.qid for item in bank}
    if any(qid not in known for qid in body.question_ids):
        raise ValueError("选题中存在当前题库不可用的题目，请刷新题库后重试")
    history, history_warnings = load_history(root, bank, body.exclude_exam_id)
    return _duplicates(bank, history, body.question_ids, body.similarity_threshold, warnings + history_warnings)


def generate_paper(root: Path, body: AutoComposeBody) -> dict[str, Any]:
    path, relative = resolve_template_under_project(root, body.template_path, body.template_ref)
    if not path.is_relative_to((root / "templates").resolve()):
        raise ValueError("自动组卷的模板必须位于 templates 目录内")
    if not path.is_file():
        raise ValueError("模板文件不存在，请刷新模板后重试")
    template = load_template(path)
    if body.template_ref and template.template_id != body.template_ref:
        raise ValueError("试卷绑定的版式与当前模板不一致，请重新选择模板")
    slots, counts, type_target = build_slots(template, body)
    bank, warnings = load_catalog(root)
    candidates = [item for item in bank if item.subject == body.subject]
    if body.namespaces:
        requested = set(body.namespaces)
        if requested - {item.namespace for item in candidates}:
            raise ValueError("请求的题集不在当前学科的可用题库中，请刷新后重试")
        candidates = [item for item in candidates if item.namespace in requested]
    excluded = set(body.exclude_question_ids)
    candidates = [item for item in candidates if item.qid not in excluded and any(
        slot.count and slot.accepts(item) for slot in slots)]
    history, history_warnings = load_history(root, bank, body.exclude_exam_id)
    warnings.extend(history_warnings)
    scan_warnings = list(warnings)
    excluded_history_count = 0
    if body.avoid_history:
        conflicts = history_conflicts(candidates, history, body.similarity_threshold)
        candidates = [item for item in candidates if item.qid not in conflicts]
        excluded_history_count = len(conflicts)
    chosen = choose_questions(candidates, slots, body)
    selected_items = [{
        "section_id": section.section_id,
        "question_ids": [item.qid for item in chosen.get(section.section_id, [])],
        "required_count": counts[section.section_id],
        "score_per_item": section.score_per_item,
    } for section in template.sections]
    flat = [item for section in template.sections for item in chosen.get(section.section_id, [])]
    actual_difficulty = Counter(item.difficulty for item in flat)
    difficulty_target = apportion(body.total_count, body.difficulty_distribution)
    difficulty_met = not difficulty_target or all(
        actual_difficulty[key] == difficulty_target.get(key, 0)
        for key in set(actual_difficulty) | set(difficulty_target))
    if body.type_distribution:
        actual_types = {key: sum(matches_type(item.type, key) for item in flat) for key in type_target}
    else:
        actual_types: dict[str, int] = {}
        for section in template.sections:
            if section.type != "text":
                actual_types[section.type] = actual_types.get(section.type, 0) + len(chosen.get(section.section_id, []))
    types_met = actual_types == type_target
    points = set(body.knowledge_points)
    covered = set().union(*(item.knowledge & points for item in flat)) if flat else set()
    coverage = len(covered) / len(points) if points else 1.0
    coverage_met = len(covered) >= math.ceil(len(points) * body.coverage_ratio - 1e-12)
    sections = [{
        "section_id": section.section_id, "requested_count": counts[section.section_id],
        "actual_count": len(chosen.get(section.section_id, [])),
    } for section in template.sections]
    count_met = len(flat) == body.total_count
    if not count_met:
        warnings.append(f"可用题目不足：目标 {body.total_count} 题，实际选出 {len(flat)} 题；未自动降低目标题量。")
    if not difficulty_met:
        warnings.append("难度分布未完全达标，请查看目标与实际题量，或补充相应难度题目。")
    if not coverage_met:
        warnings.append("知识点覆盖率未达标，请查看未覆盖知识点，或补充题目、调整目标。")
    if not types_met:
        warnings.append("题型比例未完全达标，请查看各小节的缺题数量。")
    unknown_count = actual_difficulty["unknown"]
    if unknown_count:
        warnings.append(f"已选 {unknown_count} 道题未标注可识别的难度，单独计入“未标注”。")
    goals_met = count_met and difficulty_met and coverage_met and types_met
    duplicate_report = _duplicates(bank, history, [item.qid for item in flat], body.similarity_threshold, scan_warnings)
    return {
        "ok": True, "complete": goals_met,
        "template_ref": template.template_id, "template_path": relative,
        "selected_items": selected_items,
        "requested_count": body.total_count, "generated_count": len(flat),
        "candidate_count": len(candidates), "excluded_history_count": excluded_history_count,
        "goals": {
            "knowledge": {"target_points": body.knowledge_points,
                          "covered_points": [point for point in body.knowledge_points if point in covered],
                          "missing_points": [point for point in body.knowledge_points if point not in covered],
                          "coverage_ratio": coverage, "required_ratio": body.coverage_ratio, "met": coverage_met},
            "difficulty": {"target": difficulty_target,
                           "actual": {key: actual_difficulty[key] for key in _DIFFICULTIES}, "met": difficulty_met},
            "types": {"target": type_target, "actual": actual_types, "met": types_met},
            "sections": sections, "met": goals_met,
        },
        "duplicate_report": duplicate_report, "warnings": _unique_warnings(warnings),
    }
