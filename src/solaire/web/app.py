"""Stable ASGI entry point for web, desktop and existing integrations."""

from solaire.web.application import create_app
from solaire.web.project_layout import ensure_project_layout

app = create_app()

__all__ = ["app", "create_app", "ensure_project_layout"]
