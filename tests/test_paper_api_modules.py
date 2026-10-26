from __future__ import annotations

from solaire.web import paper_api
from solaire.web.papers import api_models, api_routes


def test_paper_api_keeps_legacy_models_and_registers_each_route_once() -> None:
    assert paper_api.PaperPublishBody is api_models.PaperPublishBody
    assert paper_api.PaperAnswerGradeBody is api_models.PaperAnswerGradeBody
    assert paper_api.router is api_routes.router
    assert paper_api.papers_publish is api_routes.papers_publish

    route_keys = [
        (method, route.path)
        for route in api_routes.router.routes
        for method in route.methods or ()
    ]
    assert len(route_keys) == len(set(route_keys))
