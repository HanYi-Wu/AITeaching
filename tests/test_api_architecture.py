"""Composition and stable client-facing contracts for the modular API."""

from __future__ import annotations

import ast
from pathlib import Path

from fastapi.testclient import TestClient

from solaire.web.application import create_app


def test_factory_has_independent_routes_and_openapi_caches():
    first, second = create_app(), create_app()
    first.openapi()["info"]["title"] = "test only"
    assert second.openapi()["info"]["title"] == "OriginReach API"
    with TestClient(second) as client:
        assert client.get("/api/health").json()["exam_workspace_layout"] == "two_level"


def test_routes_do_not_depend_on_application_entry_or_other_routers():
    root = Path(__file__).parents[1] / "src/solaire/web/routers"
    for path in root.glob("*.py"):
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            if isinstance(node, ast.ImportFrom):
                target = node.module or ""
                assert target not in {"solaire.web.app", "solaire.web.application"}, (
                    path.name
                )
                assert not target.startswith("solaire.web.routers"), path.name


def test_legacy_export_and_draft_input_contracts():
    schema = create_app().openapi()
    models = schema["components"]["schemas"]
    assert (
        models["SelectedSectionIn"]["properties"]["required_count"]["anyOf"][0][
            "maximum"
        ]
        == 500
    )
    assert models["ExamExportBody"]["required"] == [
        "template_ref",
        "template_path",
        "selected_items",
        "export_label",
        "subject",
    ]
    for endpoint in (
        "/api/exam/export",
        "/api/exam/export-word",
        "/api/exam/preview-pdf",
    ):
        body = schema["paths"][endpoint]["post"]["requestBody"]
        assert body["content"]["application/json"]["schema"]["$ref"].endswith(
            "/ExamExportBody"
        )


def test_no_duplicate_api_method_and_path():
    endpoints = []
    for route in create_app().routes:
        for method in getattr(route, "methods", ()):
            endpoints.append((method, route.path))
    assert len(endpoints) == len(set(endpoints))
