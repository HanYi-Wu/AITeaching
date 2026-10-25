"""Composition and stable client-facing contracts for the modular API."""

from __future__ import annotations

import ast
from copy import deepcopy
import json
from pathlib import Path

import pytest
from fastapi import APIRouter, FastAPI
from fastapi.testclient import TestClient

from solaire.web.application import create_app


PAPER_CONTRACT = Path(__file__).parent / "fixtures/paper-student-contract-72934cd.json"


def _assert_legacy_contract(expected, actual, location="contract", *, properties_map=False):
    """Keep existing semantics while permitting optional, additive capabilities."""
    if isinstance(expected, dict):
        assert isinstance(actual, dict), location
        # New constraints on an existing schema can reject previously legal input.
        constraints = {
            "required", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum",
            "minLength", "maxLength", "minItems", "maxItems", "pattern", "enum",
            "const", "default", "additionalProperties", "uniqueItems", "multipleOf",
            "type", "format", "items", "minProperties", "maxProperties", "patternProperties",
            "propertyNames", "not", "if", "then", "else", "dependentRequired",
            "dependentSchemas", "unevaluatedProperties", "unevaluatedItems", "contains",
            "minContains", "maxContains", "prefixItems", "allOf", "anyOf", "oneOf", "$ref",
        }
        if not properties_map:
            for key in constraints & actual.keys():
                assert key in expected, f"{location}.{key}: new legacy constraint"
        for key, value in expected.items():
            assert key in actual, f"{location}.{key}: missing legacy contract"
            if key == "parameters":
                continue
            _assert_legacy_contract(value, actual[key], f"{location}.{key}", properties_map=key == "properties")
        # Parameters may gain optional headers, but no client gains a required input.
        if "parameters" in expected or "parameters" in actual:
            assert all("$ref" not in p for p in actual.get("parameters", [])), (
                f"{location}: inline parameters for compatibility review"
            )
            old = {(p["name"], p["in"]): p for p in expected.get("parameters", [])}
            new = {(p["name"], p["in"]): p for p in actual.get("parameters", [])}
            for key, parameter in old.items():
                assert key in new, f"{location}: missing parameter {key}"
                _assert_legacy_contract(parameter, new[key], f"{location}.parameters.{key}")
            for key in new.keys() - old.keys():
                assert not new[key].get("required"), f"{location}: new required parameter {key}"
        if "requestBody" not in expected and "requestBody" in actual:
            assert not actual["requestBody"].get("required"), location
    else:
        assert expected == actual, f"{location}: {expected!r} != {actual!r}"


def test_paper_student_legacy_routes_and_referenced_schemas():
    baseline = json.loads(PAPER_CONTRACT.read_text(encoding="utf-8"))
    assert baseline["baseline_commit"] == "72934cdcc5ff5e56213665e72459ab92e31fee9f"
    schema = create_app().openapi()
    _assert_legacy_contract(baseline["paths"], schema["paths"], "paths")
    _assert_legacy_contract(baseline["components"], schema["components"], "components")


@pytest.mark.parametrize("change", ["required", "constraint", "schema_ref", "default", "format", "minProperties", "items"])
def test_legacy_contract_guard_rejects_breaking_nested_changes(change):
    old = {"properties": {"score": {"type": "number", "default": 0}},
           "items": {"$ref": "#/components/schemas/StudentAnswerIn"}}
    new = deepcopy(old)
    if change == "required":
        new["required"] = ["score"]
    elif change == "constraint":
        new["properties"]["score"]["maximum"] = 10
    elif change == "schema_ref":
        new["items"]["$ref"] = "#/components/schemas/RenamedAnswer"
    elif change == "default":
        new["properties"]["score"]["default"] = 1
    else:
        new["properties"]["score"][change] = {"type": "integer"} if change == "items" else 1
    with pytest.raises(AssertionError):
        _assert_legacy_contract(old, new)


def test_legacy_contract_guard_preserves_old_optional_inputs_and_allows_new_properties():
    old = {"parameters": [{"name": "page", "in": "query", "required": False}],
           "properties": {"score": {"type": "number"}}}
    new = deepcopy(old)
    new["properties"]["format"] = {"type": "string", "default": "compact"}
    _assert_legacy_contract(old, new)
    new["parameters"][0]["required"] = True
    with pytest.raises(AssertionError):
        _assert_legacy_contract(old, new)


def test_legacy_contract_guard_requires_new_parameters_to_be_reviewable_inline():
    with pytest.raises(AssertionError):
        _assert_legacy_contract({}, {"parameters": [{"$ref": "#/components/parameters/RequiredVersion"}]})


def test_legacy_contract_guard_allows_only_optional_new_parameters():
    old = {"responses": {"200": {"description": "Successful Response"}}}
    new = deepcopy(old)
    new["parameters"] = [{"name": "If-Match", "in": "header", "required": False}]
    _assert_legacy_contract(old, new)
    new["parameters"][0]["required"] = True
    with pytest.raises(AssertionError):
        _assert_legacy_contract(old, new)


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
