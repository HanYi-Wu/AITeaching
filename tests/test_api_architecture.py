"""Composition and stable client-facing contracts for the modular API."""

from __future__ import annotations

import ast
from pathlib import Path

from fastapi import APIRouter, FastAPI
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


def _api_endpoints(routes):
    endpoints = []
    for route in routes:
        effective_candidates = getattr(route, "effective_candidates", None)
        if callable(effective_candidates):
            endpoints.extend(_api_endpoints(effective_candidates()))
        elif getattr(route, "path", "").startswith("/api/"):
            path = getattr(route, "path_format", route.path)
            endpoints.extend((method, path) for method in route.methods)
    return endpoints


def test_no_duplicate_api_method_and_path():
    app = create_app()
    endpoints = _api_endpoints(app.routes)
    assert len(endpoints) >= 240
    assert {
        (method.upper(), path)
        for path, operations in app.openapi()["paths"].items()
        for method in operations
    } <= set(endpoints)
    assert len(endpoints) == len(set(endpoints))


def test_duplicate_guard_checks_nested_effective_prefixes_and_http_methods():
    leaf = APIRouter()

    def endpoint():
        return {}

    leaf.add_api_route("/item", endpoint, methods=["GET"])
    leaf.add_api_route("/item", endpoint, methods=["GET", "POST"])
    parent = APIRouter(prefix="/parent")
    parent.include_router(leaf, prefix="/child")
    app = FastAPI()
    app.include_router(parent, prefix="/api")
    app.include_router(leaf, prefix="/api/other")
    endpoints = _api_endpoints(app.routes)
    assert endpoints.count(("GET", "/api/parent/child/item")) == 2
    assert endpoints.count(("POST", "/api/parent/child/item")) == 1
    assert endpoints.count(("GET", "/api/other/item")) == 2
    assert endpoints.count(("POST", "/api/other/item")) == 1
    assert len(endpoints) != len(set(endpoints))
