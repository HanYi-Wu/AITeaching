"""schemas bank."""

from __future__ import annotations

from typing import Annotated, Literal, Union
from pydantic import BaseModel, Field
from solaire.exam_compiler.facade import QuestionGroupRecord, QuestionItem

class BankImportBody(BaseModel):
    yaml: str = Field(..., description="Merged questions YAML (questions: list)")
    target_subject: str = Field(..., min_length=1, description="科目目录名，如 数学")
    target_collection: str = Field(..., min_length=1, description="题集目录名，写入 resource/<科目>/<题集>/")


class BankExportBundleBody(BaseModel):
    """题集 namespace（科目/题集）；用 POST 传递，避免 GET 查询串中 / 的编码问题。"""

    namespace: str = Field(..., min_length=1)


class BankSelectionExportBody(BaseModel):
    qualified_ids: list[str] = Field(..., min_length=1, max_length=300)
    title: str | None = Field(default=None, max_length=200)


BankRecordBody = Annotated[Union[QuestionItem, QuestionGroupRecord], Field(discriminator="type")]


class BankCreateBody(BaseModel):
    subject: str = Field(..., min_length=1)
    collection: str = Field(..., min_length=1)
    question: BankRecordBody


class BankCollectionRenameBody(BaseModel):
    namespace: str = Field(..., min_length=1, description="当前题集标识，形如 科目/题集")
    new_subject: str = Field(..., min_length=1, description="新科目目录名")
    new_collection: str = Field(..., min_length=1, description="新题集目录名")


class BankCollectionDeleteBody(BaseModel):
    namespace: str = Field(..., min_length=1, description="要删除的题集标识")


class BankRawFileBody(BaseModel):
    """Write YAML verbatim to resource/<path> (relative to resource/)."""

    path: str = Field(..., min_length=1, description="Relative path under resource/, e.g. 高考真题/questions.yaml")
    yaml: str = Field(..., description="Full file contents")


class BankFolderActionBody(BaseModel):
    action: Literal['create', 'rename', 'move', 'remove', 'move_folder']
    path: str = Field(default='', max_length=240)
    target: str = Field(default='', max_length=240)
    qualified_ids: list[str] = Field(default_factory=list, max_length=500)


class BankShareBody(BaseModel):
    action: Literal['create', 'redeem', 'revoke']
    path: str = Field(default='', max_length=240)
    code: str = Field(default='', max_length=100)
