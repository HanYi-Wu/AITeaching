"""FastAPI routes and dependencies for platform authentication."""

from __future__ import annotations

from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from solaire.web import state
from solaire.web.auth_service import (
    authenticate_user,
    bootstrap_admin,
    create_session,
    get_session_user,
    get_user_profile,
    has_admin,
    revoke_session,
    update_user_credentials,
    update_user_profile,
)
from solaire.web.platform_db import default_platform_root, init_platform_db

router = APIRouter()


class BootstrapAdminBody(BaseModel):
    username: str = Field(..., min_length=3)
    password: str = Field(..., min_length=6)
    display_name: str = Field(default="")


class LoginBody(BaseModel):
    username: str = Field(..., min_length=1)
    password: str = Field(..., min_length=1)


class StudentAccountUpdateBody(BaseModel):
    username: str | None = Field(default=None, min_length=3)
    current_password: str = Field(..., min_length=1)
    new_password: str | None = Field(default=None, min_length=6)


class ProfileUpdateBody(BaseModel):
    avatar_data_url: str | None = None
    preferences: dict[str, Any] = Field(default_factory=dict)
    subjects: list[str] | None = None


def require_platform_root() -> Path:
    root = default_platform_root()
    init_platform_db(root)
    return root


def extract_session_token(
    authorization: Annotated[str | None, Header()] = None,
    x_solaire_session: Annotated[str | None, Header(alias="X-Solaire-Session")] = None,
) -> str | None:
    if authorization:
        scheme, _, token = authorization.partition(" ")
        if scheme.lower() == "bearer" and token.strip():
            return token.strip()
    if x_solaire_session and x_solaire_session.strip():
        return x_solaire_session.strip()
    return None


def current_platform_user(
    authorization: Annotated[str | None, Header()] = None,
    x_solaire_session: Annotated[str | None, Header(alias="X-Solaire-Session")] = None,
) -> dict[str, Any]:
    root = require_platform_root()
    token = extract_session_token(authorization=authorization, x_solaire_session=x_solaire_session)
    user = get_session_user(root, token)
    if user is None:
        raise HTTPException(status_code=401, detail="Authentication required")
    return user


def current_session_token(
    authorization: Annotated[str | None, Header()] = None,
    x_solaire_session: Annotated[str | None, Header(alias="X-Solaire-Session")] = None,
) -> str | None:
    return extract_session_token(authorization=authorization, x_solaire_session=x_solaire_session)


@router.get("/platform/status")
def platform_status() -> dict[str, Any]:
    from solaire.web.public_access import public_mode_enabled

    root = require_platform_root()
    return {
        "project_bound": state.get_root() is not None,
        "admin_exists": has_admin(root),
        "public_mode": public_mode_enabled(),
    }


@router.post("/auth/bootstrap-admin")
def auth_bootstrap_admin(body: BootstrapAdminBody) -> dict[str, Any]:
    root = require_platform_root()
    try:
        user = bootstrap_admin(
            root,
            username=body.username,
            password=body.password,
            display_name=body.display_name,
        )
    except ValueError as e:
        msg = str(e)
        status = 409 if "admin already exists" in msg else 400
        raise HTTPException(status_code=status, detail=msg) from e
    token = create_session(root, str(user["id"]))
    return {"user": user, "token": token}


@router.post("/auth/login")
def auth_login(body: LoginBody) -> dict[str, Any]:
    root = require_platform_root()
    user = authenticate_user(root, body.username, body.password)
    if user is None:
        raise HTTPException(status_code=401, detail="用户名或密码错误")
    token = create_session(root, str(user["id"]))
    return {"user": user, "token": token}


@router.get("/auth/me")
def auth_me_route(
    authorization: Annotated[str | None, Header()] = None,
    x_solaire_session: Annotated[str | None, Header(alias="X-Solaire-Session")] = None,
) -> dict[str, Any]:
    return {"user": current_platform_user(authorization=authorization, x_solaire_session=x_solaire_session)}


@router.get("/auth/profile")
def auth_profile_get(
    authorization: Annotated[str | None, Header()] = None,
    x_solaire_session: Annotated[str | None, Header(alias="X-Solaire-Session")] = None,
) -> dict[str, Any]:
    user = current_platform_user(authorization=authorization, x_solaire_session=x_solaire_session)
    return {"profile": get_user_profile(require_platform_root(), str(user["id"]))}


@router.patch("/auth/profile")
def auth_profile_update(
    body: ProfileUpdateBody,
    authorization: Annotated[str | None, Header()] = None,
    x_solaire_session: Annotated[str | None, Header(alias="X-Solaire-Session")] = None,
) -> dict[str, Any]:
    user = current_platform_user(authorization=authorization, x_solaire_session=x_solaire_session)
    try:
        profile = update_user_profile(
            require_platform_root(),
            user=user,
            avatar_data_url=body.avatar_data_url,
            preferences=body.preferences,
            subjects=body.subjects,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"profile": profile}


def _update_account_credentials(
    body: StudentAccountUpdateBody,
    user: dict[str, Any],
) -> dict[str, Any]:
    wants_username = bool(body.username and body.username.strip())
    wants_password = bool(body.new_password)
    if wants_username == wants_password:
        raise HTTPException(status_code=400, detail="Choose exactly one of username or password")
    if bool(user.get("must_change_password")) and wants_username:
        raise HTTPException(status_code=400, detail="Password change is required on first login")
    root = require_platform_root()
    try:
        updated = update_user_credentials(
            root,
            user_id=str(user["id"]),
            username=body.username,
            current_password=body.current_password,
            new_password=body.new_password,
        )
    except ValueError as e:
        message = str(e)
        friendly = {
            "current password is invalid": "当前密码错误",
            "username already exists": "该用户名已被使用",
            "password change is required before username changes": "首次登录必须先修改密码",
        }.get(message, message)
        raise HTTPException(status_code=400, detail=friendly) from e
    return {"user": updated}


@router.patch("/auth/account")
def auth_account_update(
    body: StudentAccountUpdateBody,
    authorization: Annotated[str | None, Header()] = None,
    x_solaire_session: Annotated[str | None, Header(alias="X-Solaire-Session")] = None,
) -> dict[str, Any]:
    user = current_platform_user(authorization=authorization, x_solaire_session=x_solaire_session)
    return _update_account_credentials(body, user)


@router.patch("/student/account")
def student_account_update(
    body: StudentAccountUpdateBody,
    authorization: Annotated[str | None, Header()] = None,
    x_solaire_session: Annotated[str | None, Header(alias="X-Solaire-Session")] = None,
) -> dict[str, Any]:
    user = current_platform_user(authorization=authorization, x_solaire_session=x_solaire_session)
    if user.get("role") != "student":
        raise HTTPException(status_code=403, detail="Student role required")
    return _update_account_credentials(body, user)


@router.post("/auth/logout")
def auth_logout(
    authorization: Annotated[str | None, Header()] = None,
    x_solaire_session: Annotated[str | None, Header(alias="X-Solaire-Session")] = None,
) -> dict[str, bool]:
    root = require_platform_root()
    token = current_session_token(authorization=authorization, x_solaire_session=x_solaire_session)
    if not token:
        raise HTTPException(status_code=401, detail="Authentication required")
    revoke_session(root, token)
    return {"ok": True}
