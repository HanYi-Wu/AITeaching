"""Application composition and middleware registration.

Business routes and services do not import this module. The legacy ``app:app``
entry point delegates here so desktop and server launch commands stay stable.
"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from solaire.common.runtime_config import load_runtime_config

load_runtime_config()

from solaire.edu_analysis.ports import configure
from solaire.exam_compiler import __version__
from solaire.web import state
from solaire.web.public_access import allowed_origins
from solaire.web.request_context import bind_request_context
from solaire.web.result_service import ResultServiceAdapter
from solaire.web.routing import register_routes


@asynccontextmanager
async def lifespan(_app: FastAPI):
    state.init_from_env()
    yield


def create_app() -> FastAPI:
    """Build an independent ASGI application with the standard API contract."""
    configure(result_port=ResultServiceAdapter())
    app = FastAPI(title="OriginReach API", version=__version__, lifespan=lifespan)

    @app.exception_handler(PermissionError)
    async def permission_denied(_request, exc: PermissionError):
        return JSONResponse(status_code=403, content={"detail": str(exc)})

    register_routes(app)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins(),
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=[
            "Authorization",
            "Content-Type",
            "If-Match",
            "X-Solaire-Session",
            "X-Solaire-Control-Token",
        ],
    )
    # Register last to preserve the original outermost access/actor boundary.
    app.middleware("http")(bind_request_context)
    return app
