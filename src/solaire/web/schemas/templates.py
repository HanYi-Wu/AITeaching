"""schemas templates."""

from __future__ import annotations

from pydantic import BaseModel, Field

class TemplateRawFileBody(BaseModel):
    """Read/write template YAML under templates/ (relative to project root)."""

    path: str = Field(..., min_length=1, description="Relative path under project root, e.g. templates/demo.yaml")
    yaml: str | None = Field(default=None, description="For PUT: full file contents")
    rename_to: str | None = Field(
        default=None,
        description="If set after a successful save, rename the file to this path (same directory only).",
    )


class TemplateRenameBody(BaseModel):
    """Rename a template file under templates/ (same directory only)."""

    from_path: str = Field(..., min_length=1, description="Current path, e.g. templates/old.yaml")
    to_path: str = Field(..., min_length=1, description="New path, e.g. templates/new.yaml")
