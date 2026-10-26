"""Domain models and structural validation for KnowledgeForge."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

_ALLOWED_NODE_KINDS = frozenset({"concept", "skill", "causal"})

_ALLOWED_RELATION_TYPES = frozenset(
    {
        # 先修
        "prerequisite",
        # 组成
        "part_of",
        # 弱关联（含原「技能依赖」边迁移后的概念↔技能弱连接）
        "related",
        # 因果
        "causal",
    }
)


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


class GraphNodeNote(BaseModel):
    """图谱节点上的多条维护笔记（富文本与题目题干同源序列化）。"""

    model_config = ConfigDict(extra="ignore")

    id: str = Field(min_length=1)
    body: str = Field(default="", description="HTML/占位串，前端用 ContentWithPrimeBrush 预览")
    created_at: datetime = Field(default_factory=_now_utc)


class ConceptNode(BaseModel):
    """图谱节点；需求书中的 Concept / Skill / Causal 以 node_kind 区分（同表存储）。"""

    model_config = ConfigDict(extra="ignore")

    id: str = Field(min_length=1)
    canonical_name: str = Field(min_length=1)
    node_kind: Literal["concept", "skill", "causal"] = Field(
        default="concept",
        description="节点类型：知识点 / 技能 / 因果",
    )
    aliases: list[str] = Field(default_factory=list)
    subject: str | None = None
    level: str | None = None
    description: str | None = None
    tags: list[str] = Field(default_factory=list)
    source: str | None = None
    layout_x: float | None = None
    layout_y: float | None = None
    primary_parent_id: str | None = None
    """思维导图视角的主父节点 ID，用于构建严格树结构。"""
    notes: list[GraphNodeNote] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=_now_utc)
    updated_at: datetime = Field(default_factory=_now_utc)

    @field_validator("node_kind", mode="before")
    @classmethod
    def _coerce_node_kind(cls, v: Any) -> str:
        if v is None or v == "":
            return "concept"
        s = str(v).strip()
        if s not in _ALLOWED_NODE_KINDS:
            raise ValueError(f"Invalid node_kind: {v}")
        return s


class GraphTaxonomy(BaseModel):
    """学科、层级等下拉选项（可由前端追加）。"""

    subjects: list[str] = Field(default_factory=lambda: ["数学"])
    levels: list[str] = Field(default_factory=lambda: ["高中", "高考"])


class NodeFileLink(BaseModel):
    id: str = Field(min_length=1)
    node_id: str = Field(min_length=1)
    relative_path: str = Field(min_length=1, description="相对 resource/ 的路径")
    created_at: datetime = Field(default_factory=_now_utc)


class NodeRelation(BaseModel):
    id: str = Field(min_length=1)
    from_node_id: str = Field(min_length=1)
    to_node_id: str = Field(min_length=1)
    relation_type: str


class QuestionBinding(BaseModel):
    question_qualified_id: str = Field(min_length=1)
    node_id: str = Field(min_length=1)


class GraphState(BaseModel):
    version: int = 1
    taxonomy: GraphTaxonomy = Field(default_factory=GraphTaxonomy)
    nodes: list[ConceptNode] = Field(default_factory=list)
    relations: list[NodeRelation] = Field(default_factory=list)
    bindings: list[QuestionBinding] = Field(default_factory=list)
    file_links: list[NodeFileLink] = Field(default_factory=list)


class SubjectMeta(BaseModel):
    """单个科目图谱的元信息。"""

    slug: str = Field(min_length=1)
    display_name: str = Field(min_length=1)
    node_count: int = 0


class GraphMeta(BaseModel):
    """全局图谱元信息，存储在 _meta.yaml。"""

    version: int = 1
    subjects: list[SubjectMeta] = Field(default_factory=list)
    levels: list[str] = Field(default_factory=lambda: ["高中", "高考"])


def _node_kind_of(state: GraphState, node_id: str) -> str:
    for n in state.nodes:
        if n.id == node_id:
            return n.node_kind
    return "concept"


def _validate_relation_endpoints(state: GraphState, from_node_id: str, to_node_id: str) -> None:
    """技能节点与因果节点之间不可连边；至少一端须为知识点。"""
    kf = _node_kind_of(state, from_node_id)
    kt = _node_kind_of(state, to_node_id)
    if kf != "concept" and kt != "concept":
        raise ValueError("关系仅允许至少一端为知识点节点（技能与因果节点之间不可互连）")
