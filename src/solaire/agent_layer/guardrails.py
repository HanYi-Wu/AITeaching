"""Guardrails: tool risk tiers, confirmation, session-level auto-approve for writes."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from solaire.agent_layer.llm.adapter import LLMAdapter
from solaire.agent_layer.models import GuardrailDecision, InvocationContext, SessionState, ToolRisk
from solaire.agent_layer.user_agent_paths import user_agent_state_dir
from solaire.common.security import assert_within_project


@dataclass(frozen=True)
class ToolPolicy:
    risk: ToolRisk
    requires_confirmation_override: bool | None = None


SAFETY_MODE_MODERATO = "moderato"
SAFETY_MODE_ALLEGRO = "allegro"
SAFETY_MODE_VIVACE = "vivace"
SAFETY_MODE_PRESTISSIMO = "prestissimo"
SAFETY_MODE_CHOICES = (
    SAFETY_MODE_MODERATO,
    SAFETY_MODE_ALLEGRO,
    SAFETY_MODE_VIVACE,
    SAFETY_MODE_PRESTISSIMO,
)
_SAFETY_MODE_FILE = "safety_mode.json"

SAFETY_MODE_LABELS: dict[str, str] = {
    SAFETY_MODE_MODERATO: "Moderato Mode",
    SAFETY_MODE_ALLEGRO: "Allegro Mode",
    SAFETY_MODE_VIVACE: "Vivace Mode",
    SAFETY_MODE_PRESTISSIMO: "Prestissimo Mode",
}


def _tool_registry() -> Any:
    from solaire.agent_layer import registry

    return registry

def _safety_mode_path(project_root: Path) -> Path:
    p = (project_root / ".solaire" / "agent" / _SAFETY_MODE_FILE).resolve()
    assert_within_project(project_root, p)
    return p


def _user_safety_mode_path() -> Path:
    return user_agent_state_dir() / _SAFETY_MODE_FILE


def _read_safety_mode_file(path: Path) -> str | None:
    if not path.is_file():
        return None
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    mode = str(raw.get("mode") or "").strip().lower()
    if mode in SAFETY_MODE_CHOICES:
        return mode
    return None


def load_safety_mode(project_root: Path | None) -> str:
    mode = SAFETY_MODE_ALLEGRO
    u = _read_safety_mode_file(_user_safety_mode_path())
    if u is not None:
        mode = u
    if project_root is not None:
        p = _read_safety_mode_file(_safety_mode_path(project_root))
        if p is not None:
            mode = p
    return mode


def save_user_safety_mode(mode: str) -> None:
    m = mode.strip().lower()
    if m not in SAFETY_MODE_CHOICES:
        raise ValueError("invalid safety mode")
    p = _user_safety_mode_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps({"mode": m}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def save_safety_mode(project_root: Path, mode: str) -> None:
    m = mode.strip().lower()
    if m not in SAFETY_MODE_CHOICES:
        raise ValueError("invalid safety mode")
    p = _safety_mode_path(project_root)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps({"mode": m}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def list_safety_modes_public() -> list[dict[str, str]]:
    return [
        {
            "id": SAFETY_MODE_MODERATO,
            "label": SAFETY_MODE_LABELS[SAFETY_MODE_MODERATO],
            "description": "新增、编辑、删除都需要确认；查看类操作直接执行。",
        },
        {
            "id": SAFETY_MODE_ALLEGRO,
            "label": SAFETY_MODE_LABELS[SAFETY_MODE_ALLEGRO],
            "description": "新增直接执行；编辑与删除需要确认。",
        },
        {
            "id": SAFETY_MODE_VIVACE,
            "label": SAFETY_MODE_LABELS[SAFETY_MODE_VIVACE],
            "description": "大多数操作直接执行；高危操作会先快速复核，疑似风险时再确认。",
        },
        {
            "id": SAFETY_MODE_PRESTISSIMO,
            "label": SAFETY_MODE_LABELS[SAFETY_MODE_PRESTISSIMO],
            "description": "所有操作都直接执行，不再进行确认。",
        },
    ]


def policy_for(tool_name: str) -> ToolPolicy:
    rt = _tool_registry().get_registered_tool(tool_name)
    if rt is None:
        return ToolPolicy(ToolRisk.READ)
    return ToolPolicy(risk=rt.risk, requires_confirmation_override=rt.requires_confirmation_override)


def vivace_needs_fast_model_review(tool_name: str) -> bool:
    """Whether Vivace mode runs the extra fast-model safety pass for this tool (see tool_executor)."""
    rt = _tool_registry().get_registered_tool(tool_name)
    return bool(rt and rt.vivace_fast_review)


_SAFE_TOOL_NAME_RE = re.compile(r"[^\w\s:.\-一-鿿]")


def _sanitize_tool_name(name: str) -> str:
    return _SAFE_TOOL_NAME_RE.sub("", str(name))[:100]


async def vivace_fast_review(
    *,
    fast_adapter: LLMAdapter,
    tool_name: str,
    args: dict[str, Any],
) -> tuple[bool, str]:
    """返回 (需要人工确认, 原因摘要)。需要确认时第一个元素为 True。"""
    try:
        safe_name = _sanitize_tool_name(tool_name)
        prompt = (
            "你是安全复核器。判断下面操作是否可能造成较大风险。\n"
            "若需要人工确认，只输出 RISKY:原因；否则输出 SAFE:原因。\n\n"
            "---BEGIN OPERATION---\n"
            f"Tool: {safe_name}\n"
            f"Arguments: {json.dumps(args, ensure_ascii=False, default=str)[:1200]}\n"
            "---END OPERATION---\n\n"
            "请评估以上操作。"
        )
        resp = await fast_adapter.chat(
            [
                {"role": "system", "content": "只输出一行，格式必须是 SAFE:... 或 RISKY:..."},
                {"role": "user", "content": prompt},
            ],
            temperature=0.0,
        )
        txt = (resp.content or "").strip()
        upper = txt.upper()
        if upper.startswith("RISKY:"):
            return True, (txt.split(":", 1)[1] or "存在潜在风险").strip()
        return False, (txt.split(":", 1)[1] if ":" in txt else txt or "风险较低，可直接执行").strip()
    except Exception:
        return True, "快速复核异常，已转为人工确认以保证安全。"


def check_tool_call(
    tool_name: str,
    args: dict,
    ctx: InvocationContext,
    *,
    safety_mode: str | None = None,
) -> GuardrailDecision:
    mode = (safety_mode or load_safety_mode(ctx.project_root)).strip().lower()
    pol = policy_for(tool_name)
    if pol.requires_confirmation_override is True:
        return GuardrailDecision.NEEDS_CONFIRMATION
    if mode == SAFETY_MODE_PRESTISSIMO:
        return GuardrailDecision.AUTO_APPROVE
    if mode == SAFETY_MODE_MODERATO:
        return GuardrailDecision.AUTO_APPROVE if pol.risk == ToolRisk.READ else GuardrailDecision.NEEDS_CONFIRMATION
    if mode == SAFETY_MODE_ALLEGRO:
        if pol.risk == ToolRisk.READ:
            return GuardrailDecision.AUTO_APPROVE
        if pol.risk == ToolRisk.DESTRUCTIVE:
            return GuardrailDecision.NEEDS_CONFIRMATION
        rt = _tool_registry().get_registered_tool(tool_name)
        allegro_add = bool(rt and rt.allegro_auto_add)
        return GuardrailDecision.AUTO_APPROVE if allegro_add else GuardrailDecision.NEEDS_CONFIRMATION
    if mode == SAFETY_MODE_VIVACE:
        # Vivace 下默认放行；高危动作由 orchestrator 的快速复核进一步判定
        return GuardrailDecision.AUTO_APPROVE

    if pol.risk == ToolRisk.READ:
        return GuardrailDecision.AUTO_APPROVE
    if pol.risk == ToolRisk.DESTRUCTIVE:
        return GuardrailDecision.NEEDS_CONFIRMATION
    # WRITE
    if ctx.mode == "suggest":
        return GuardrailDecision.NEEDS_CONFIRMATION
    session = ctx.session
    if session is None:
        return GuardrailDecision.NEEDS_CONFIRMATION
    key = ctx.approved_key(tool_name, args)
    if key in session.approved_write_keys:
        return GuardrailDecision.AUTO_APPROVE
    return GuardrailDecision.NEEDS_CONFIRMATION


def human_confirmation_message(tool_name: str, args: dict) -> str:
    if tool_name == "paper.publish_wrong_question_practice":
        recipient = f"仅学生 {args['student_id']}" if args.get("student_id") else f"班级 {args.get('class_id') or '未指定'}"
        return f"发布错题练习「{args.get('title') or '未命名'}」给{recipient}？来源发布：{args.get('source_publication_id') or '未指定'}。"
    if tool_name == "exam.publish_online_paper":
        paper = str(args.get("paper_title") or args.get("title") or args.get("paper_id") or args.get("exam_id") or "未指定试卷")
        folder = str(args.get("folder_name") or args.get("folder_id") or "未指定文件夹")
        students = args.get("student_names") or args.get("student_ids") or []
        classes = args.get("class_names") or args.get("class_ids") or []
        recipients = f"指定学生：{'、'.join(map(str, students))}" if students else f"班级：{'、'.join(map(str, classes))}"
        timing = f"开始：{args.get('start_at') or '立即'}；截止：{args.get('end_at') or '不限'}"
        return f"确认发布试卷「{paper}」？文件夹：{folder}；{recipients}；{timing}。请核对后继续。"
    if tool_name == 'bank.create_items':
        questions = args.get('questions') or []
        ids = '、'.join(str(q.get('question_id', '')) for q in questions[:12] if isinstance(q, dict))
        return f'确认一次创建这批 {len(questions)} 道题目？题号：{ids}。成功项保留，失败项会单独列出，不覆盖已有题目。'
    rt = _tool_registry().get_registered_tool(tool_name)
    label = (rt.action_label if rt and rt.action_label else None) or "一项可能影响数据的操作"
    return f"助手请求执行：{label}。请确认是否继续。"


def question_confirmation_preview(tool_name: str, args: dict) -> dict | None:
    if tool_name not in {"bank.create_item", "bank.create_items"}:
        return None
    questions = args.get("questions") if tool_name == "bank.create_items" else [args]
    if not isinstance(questions, list) or not 1 <= len(questions) <= 50:
        raise ValueError("题目预览必须包含 1 至 50 道题")
    preview = []
    for question in questions:
        if not isinstance(question, dict):
            raise ValueError("题目必须为对象")
        options = question.get("options") or {}
        if isinstance(options, str):
            options = json.loads(options) if options.strip() else {}
        if not isinstance(options, dict):
            raise ValueError("选项必须为对象")
        subject = str(question.get("subject") or args.get("subject") or "通用").strip() or "通用"
        preview.append({
            "id": str(question.get("question_id") or "").strip(),
            "type": str(question.get("question_type") or "").strip(),
            "subject": subject,
            "content": str(question.get("content") or ""),
            "answer": str(question.get("answer") or ""),
            "analysis": str(question.get("analysis") or ""),
            "options": [{"label": str(label), "text": str(text)} for label, text in options.items()],
        })
    value = {"kind": "question_creation", "questions": preview}
    if len(json.dumps(value, ensure_ascii=False).encode("utf-8")) > 256_000:
        raise ValueError("这批题目的完整预览过长，请拆分批次后再提交")
    return value


def apply_question_review(args: dict, review: list[dict]) -> dict:
    originals = args.get("questions")
    if not isinstance(originals, list) or not 1 <= len(review) <= len(originals) <= 50:
        raise ValueError("请选择原批次中的至少一道题")
    chosen = {}
    for edit in review:
        index = edit.get("index")
        if type(index) is not int or not 0 <= index < len(originals) or index in chosen:
            raise ValueError("待确认题目的序号无效或重复")
        if set(edit) - {"index", "content", "answer", "analysis", "options"}:
            raise ValueError("不能修改题目编号、题型、学科或写入位置")
        original = originals[index]
        fields = {key: value for key, value in edit.items() if key != "index"}
        for key in {"content", "answer", "analysis"} & fields.keys():
            if not isinstance(fields[key], str) or len(fields[key]) > 20_000 or (key == "content" and not fields[key].strip()):
                raise ValueError("题干不能为空，且题目字段不能超出长度限制")
        if "options" in fields:
            options = fields["options"]
            old = original.get("options") or {}
            if not isinstance(options, dict) or not isinstance(old, dict) or options.keys() != old.keys() or any(
                not isinstance(value, str) or not value.strip() or len(value) > 20_000 for value in options.values()
            ):
                raise ValueError("只能修改原有选项的文字，且选项不能为空")
        chosen[index] = {**original, **fields}
    merged = {**args, "questions": [chosen[index] for index in sorted(chosen)]}
    question_confirmation_preview("bank.create_items", merged)
    return merged


_MAX_APPROVED_KEYS = 50


def register_approval(session: SessionState, ctx: InvocationContext, tool_name: str, args: dict) -> None:
    session.approved_write_keys.append(ctx.approved_key(tool_name, args))
    if len(session.approved_write_keys) > _MAX_APPROVED_KEYS:
        session.approved_write_keys = session.approved_write_keys[-_MAX_APPROVED_KEYS:]
