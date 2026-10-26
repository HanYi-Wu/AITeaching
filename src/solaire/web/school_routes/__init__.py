"""School management modular routers package."""

from __future__ import annotations

from solaire.web.school_routes.accounts import router as accounts_router
from solaire.web.school_routes.classes import router as classes_router
from solaire.web.school_routes.policy import router as policy_router
from solaire.web.school_routes.schools import router as schools_router

__all__ = [
    "accounts_router",
    "classes_router",
    "policy_router",
    "schools_router",
]
