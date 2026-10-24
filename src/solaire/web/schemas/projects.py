"""schemas projects."""

from __future__ import annotations

from typing import Literal
from pydantic import BaseModel

class ProjectOpenBody(BaseModel):
    root: str


class ProjectCreateBody(BaseModel):
    parent: str
    name: str
    template: Literal["empty", "math"] = "empty"


class RecentProjectRemoveBody(BaseModel):
    path: str
