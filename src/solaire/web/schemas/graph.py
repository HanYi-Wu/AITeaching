"""schemas graph."""

from __future__ import annotations

from typing import Any
from pydantic import BaseModel, Field

class GraphCreateBody(BaseModel):
    display_name: str = Field(..., min_length=1, description="图谱名称（对应科目名）")
    slug: str | None = Field(default=None, description="内部标识；留空则自动生成")


class GraphRenameBody(BaseModel):
    display_name: str = Field(..., min_length=1, description="新名称")


class GraphImportBody(BaseModel):
    bundle: dict[str, Any] = Field(..., description="由图谱导出得到的 JSON 对象")
    slug: str | None = Field(default=None, description="可选的新图谱内部标识")


class GraphNodeNoteBody(BaseModel):
    """图谱节点笔记项（与 knowledge_forge.GraphNodeNote 对齐）。"""

    id: str = Field(..., min_length=1)
    body: str = Field(default="", description="富文本正文")
    created_at: str | None = Field(default=None, description="ISO8601，可选")


class GraphNodeCreateBody(BaseModel):
    id: str | None = Field(default=None, description="知识点标识；留空则根据父级与名称自动生成")
    parent_node_id: str | None = Field(default=None, description="父级知识点标识；留空时需手动填写 id")
    node_kind: str | None = Field(
        default=None,
        description="节点类型：知识点 concept / 技能 skill / 因果 causal",
    )
    canonical_name: str = Field(..., min_length=1, description="Canonical name")
    aliases: list[str] = Field(default_factory=list, description="Aliases")
    subject: str | None = Field(default=None, description="Subject/discipline")
    level: str | None = Field(default=None, description="Level/stage")
    description: str | None = Field(default=None, description="Short description")
    tags: list[str] = Field(default_factory=list, description="Tags")
    source: str | None = Field(default=None, description="Original source")
    layout_x: float | None = Field(default=None, description="画布坐标 X")
    layout_y: float | None = Field(default=None, description="画布坐标 Y")
    primary_parent_id: str | None = Field(default=None, description="思维导图主父节点 ID")
    notes: list[GraphNodeNoteBody] | None = Field(default=None, description="维护笔记列表；不传则更新时不改已有笔记")


class GraphRelationCreateBody(BaseModel):
    from_node_id: str = Field(..., min_length=1)
    to_node_id: str = Field(..., min_length=1)
    relation_type: str = Field(..., min_length=1)


class GraphRelationUpdateBody(BaseModel):
    relation_type: str | None = Field(default=None, description="新关系类型")
    reverse: bool = Field(default=False, description="是否颠倒方向")


class GraphBindingCreateBody(BaseModel):
    question_qualified_id: str = Field(..., min_length=1)
    node_id: str = Field(..., min_length=1)


class GraphBindingBatchBody(BaseModel):
    qualified_ids: list[str] = Field(default_factory=list, description="题目全限定 id 列表")


class GraphTaxonomyBody(BaseModel):
    subjects: list[str] = Field(default_factory=list)
    levels: list[str] = Field(default_factory=list)


class GraphFileLinkBody(BaseModel):
    node_id: str = Field(..., min_length=1)
    relative_path: str = Field(..., min_length=1, description="相对 resource/ 的文件路径")
