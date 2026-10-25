"""schemas system."""

from __future__ import annotations

from typing import Literal
from pydantic import BaseModel, Field

class PrimeBrushRenderBody(BaseModel):
    source: str = Field(..., min_length=1, max_length=100_000)
    seed: int | None = None


class ExtensionManualPathBody(BaseModel):
    """User-selected install location for an extension (folder or executable)."""

    path: str = Field(..., min_length=1)
    location_kind: Literal["dir", "file"] = "file"


class ExtensionPickDialogBody(BaseModel):
    dialog: Literal["dir", "file"] = "file"
