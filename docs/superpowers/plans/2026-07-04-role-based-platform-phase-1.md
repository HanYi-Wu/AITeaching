# Role-Based Platform Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first usable platform foundation: project-local SQLite platform state, admin bootstrap, login/session APIs, school/teacher/class/student management, and role-aware frontend shells without changing the existing exam authoring workflow.

**Architecture:** Keep existing Solaire project files as-is and add `.solaire/platform.db` plus a small set of focused FastAPI routers under `src/solaire/web/`. The current `App.tsx` remains the main shell, but it gains platform auth state and role-specific entry surfaces while preserving the current teacher workspace for exam authoring.

**Tech Stack:** Python 3.11+, FastAPI, sqlite3, pbkdf2 password hashing from the Python standard library, pytest/TestClient, React 18, TypeScript, Vite/Vitest.

---

## Git Rule For This Work

The user explicitly requested no `git commit` or `git push` unless they ask. Every "checkpoint" step below means:

```powershell
git status --short
git diff --stat
```

Do not commit or push.

## File Structure

- Create `src/solaire/web/platform_db.py`: owns SQLite path resolution, schema creation, row helpers, and transaction helpers.
- Create `src/solaire/web/auth_service.py`: owns password hashing, admin bootstrap, authentication, session creation, session lookup, and role checks.
- Create `src/solaire/web/auth_api.py`: exposes `/api/platform/status`, `/api/auth/bootstrap-admin`, `/api/auth/login`, `/api/auth/logout`, and `/api/auth/me`.
- Create `src/solaire/web/school_service.py`: owns school, teacher, subject, class, student, and teacher-class assignment mutations.
- Create `src/solaire/web/school_api.py`: exposes admin/school CRUD endpoints with backend role enforcement.
- Modify `src/solaire/web/app.py`: include new routers and initialize platform DB when a project opens or is created.
- Create `tests/test_platform_auth_service.py`: service-level database/auth tests.
- Create `tests/test_platform_auth_api.py`: API tests for bootstrap/login/session.
- Create `tests/test_platform_school_api.py`: API tests for admin and school management workflows.
- Create `web/src/platform/auth.ts`: frontend platform auth types and API helpers.
- Create `web/src/platform/roles.ts`: frontend role labels and navigation policy helpers.
- Create `web/src/pages/platform/PlatformLogin.tsx`: bootstrap/login screen.
- Create `web/src/pages/platform/AdminWorkspace.tsx`: admin surface shell.
- Create `web/src/pages/platform/SchoolWorkspace.tsx`: school management shell.
- Create `web/src/pages/platform/TeacherWorkspace.tsx`: wraps existing teacher workspace entry.
- Create `web/src/pages/platform/StudentWorkspace.tsx`: initial student shell.
- Modify `web/src/App.tsx`: load `/api/auth/me`, show login/bootstrap when project is open but user is anonymous, and route authenticated roles.
- Modify `web/src/app/appPages.ts`: add `papers` for the teacher sidebar entry.
- Add frontend tests only after the backend contract is stable, in `web/src/pages/platform/__tests__/PlatformLogin.test.tsx` and `web/src/platform/__tests__/roles.test.ts`.

## Task 1: Platform Database and Auth Service

**Files:**
- Create: `tests/test_platform_auth_service.py`
- Create: `src/solaire/web/platform_db.py`
- Create: `src/solaire/web/auth_service.py`

- [ ] **Step 1: Write failing service tests**

```python
from pathlib import Path

from solaire.web.auth_service import (
    authenticate_user,
    bootstrap_admin,
    create_session,
    get_session_user,
    has_admin,
    require_role,
)
from solaire.web.platform_db import connect, init_platform_db


def test_bootstrap_admin_creates_first_admin_and_blocks_second(tmp_path: Path) -> None:
    init_platform_db(tmp_path)
    assert has_admin(tmp_path) is False

    admin = bootstrap_admin(tmp_path, username="admin", password="secret123", display_name="Admin")

    assert admin["role"] == "admin"
    assert admin["username"] == "admin"
    assert has_admin(tmp_path) is True
    try:
        bootstrap_admin(tmp_path, username="root", password="secret123", display_name="Root")
    except ValueError as exc:
        assert "admin already exists" in str(exc)
    else:
        raise AssertionError("second admin bootstrap should fail")


def test_authenticate_and_session_roundtrip(tmp_path: Path) -> None:
    init_platform_db(tmp_path)
    admin = bootstrap_admin(tmp_path, username="admin", password="secret123", display_name="Admin")

    assert authenticate_user(tmp_path, "admin", "wrong") is None
    authed = authenticate_user(tmp_path, "admin", "secret123")
    assert authed is not None
    assert authed["id"] == admin["id"]

    token = create_session(tmp_path, authed["id"])
    session_user = get_session_user(tmp_path, token)
    assert session_user is not None
    assert session_user["role"] == "admin"
    assert require_role(session_user, {"admin"}) == session_user


def test_schema_is_idempotent(tmp_path: Path) -> None:
    init_platform_db(tmp_path)
    init_platform_db(tmp_path)
    with connect(tmp_path) as con:
        tables = {row["name"] for row in con.execute("select name from sqlite_master where type='table'")}
    assert {"schools", "users", "platform_sessions", "classes", "students"}.issubset(tables)
```

- [ ] **Step 2: Run the new tests and verify RED**

Run:

```powershell
.venv\Scripts\python.exe -m pytest tests/test_platform_auth_service.py -q
```

Expected: import failure for `solaire.web.auth_service` or missing functions.

- [ ] **Step 3: Implement minimal database and auth service**

Implement `platform_db.py` with:

```python
SCHEMA_VERSION = 1

def platform_db_path(root: Path) -> Path:
    return root / ".solaire" / "platform.db"

def connect(root: Path) -> sqlite3.Connection:
    path = platform_db_path(root)
    path.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(path)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    return con

def init_platform_db(root: Path) -> None:
    with connect(root) as con:
        con.executescript(SCHEMA_SQL)
        con.execute("PRAGMA user_version = ?", (SCHEMA_VERSION,))
```

Implement `auth_service.py` with pbkdf2 password hashes formatted as `pbkdf2_sha256$iterations$salt_hex$digest_hex`, plus `bootstrap_admin`, `authenticate_user`, `create_session`, `get_session_user`, and `require_role`.

- [ ] **Step 4: Run service tests and verify GREEN**

Run:

```powershell
.venv\Scripts\python.exe -m pytest tests/test_platform_auth_service.py -q
```

Expected: all tests in the file pass.

- [ ] **Step 5: Local checkpoint**

Run:

```powershell
git status --short
git diff --stat
```

Expected: only the new plan, new tests, and new backend service files are relevant to this task, plus existing unrelated generated files already present in the worktree.

## Task 2: Auth API and Project Initialization

**Files:**
- Create: `tests/test_platform_auth_api.py`
- Create: `src/solaire/web/auth_api.py`
- Modify: `src/solaire/web/app.py`

- [ ] **Step 1: Write failing API tests**

```python
from fastapi.testclient import TestClient


def test_platform_status_and_admin_bootstrap(web_client: TestClient) -> None:
    r = web_client.get("/api/platform/status")
    assert r.status_code == 200
    assert r.json()["admin_exists"] is False

    created = web_client.post(
        "/api/auth/bootstrap-admin",
        json={"username": "admin", "password": "secret123", "display_name": "Administrator"},
    )
    assert created.status_code == 200
    body = created.json()
    assert body["user"]["role"] == "admin"
    assert body["token"]
    assert web_client.get("/api/platform/status").json()["admin_exists"] is True


def test_login_me_and_logout(web_client: TestClient) -> None:
    web_client.post(
        "/api/auth/bootstrap-admin",
        json={"username": "admin", "password": "secret123", "display_name": "Administrator"},
    )
    login = web_client.post("/api/auth/login", json={"username": "admin", "password": "secret123"})
    assert login.status_code == 200
    token = login.json()["token"]

    me = web_client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200
    assert me.json()["user"]["role"] == "admin"

    logout = web_client.post("/api/auth/logout", headers={"Authorization": f"Bearer {token}"})
    assert logout.status_code == 200
    assert web_client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"}).status_code == 401
```

- [ ] **Step 2: Run the new API tests and verify RED**

Run:

```powershell
.venv\Scripts\python.exe -m pytest tests/test_platform_auth_api.py -q
```

Expected: 404 for `/api/platform/status` or import failure for `auth_api`.

- [ ] **Step 3: Implement `auth_api.py` and wire it into `app.py`**

Expose:

- `GET /api/platform/status`
- `POST /api/auth/bootstrap-admin`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `POST /api/auth/logout`

Use `Authorization: Bearer <token>` first and also accept `X-Solaire-Session` for local desktop convenience.

Modify project open/create/pick-open paths so they call `init_platform_db(root)` after `ensure_project_layout(root)`.

- [ ] **Step 4: Run auth API tests and a small project API regression**

Run:

```powershell
.venv\Scripts\python.exe -m pytest tests/test_platform_auth_api.py tests/test_recent_projects_api.py::test_project_close_unbinds -q
```

Expected: selected tests pass.

- [ ] **Step 5: Local checkpoint**

Run:

```powershell
git status --short
git diff --stat
```

Do not commit.

## Task 3: School Management Service and API

**Files:**
- Create: `tests/test_platform_school_api.py`
- Create: `src/solaire/web/school_service.py`
- Create: `src/solaire/web/school_api.py`
- Modify: `src/solaire/web/app.py`

- [ ] **Step 1: Write failing school API tests**

```python
from fastapi.testclient import TestClient


def _admin_token(client: TestClient) -> str:
    r = client.post(
        "/api/auth/bootstrap-admin",
        json={"username": "admin", "password": "secret123", "display_name": "Administrator"},
    )
    return r.json()["token"]


def test_admin_creates_school_and_school_account(web_client: TestClient) -> None:
    token = _admin_token(web_client)
    headers = {"Authorization": f"Bearer {token}"}

    school = web_client.post("/api/schools", json={"name": "No.1 School"}, headers=headers)
    assert school.status_code == 200
    school_id = school.json()["school"]["id"]

    account = web_client.post(
        f"/api/schools/{school_id}/school-users",
        json={"username": "school_a", "password": "secret123", "display_name": "School Admin"},
        headers=headers,
    )
    assert account.status_code == 200
    assert account.json()["user"]["role"] == "school"

    listed = web_client.get("/api/schools", headers=headers)
    assert listed.status_code == 200
    assert listed.json()["schools"][0]["name"] == "No.1 School"


def test_school_manages_teachers_classes_students_and_assignments(web_client: TestClient) -> None:
    admin_token = _admin_token(web_client)
    admin_headers = {"Authorization": f"Bearer {admin_token}"}
    school_id = web_client.post("/api/schools", json={"name": "No.1 School"}, headers=admin_headers).json()["school"]["id"]
    web_client.post(
        f"/api/schools/{school_id}/school-users",
        json={"username": "school_a", "password": "secret123", "display_name": "School Admin"},
        headers=admin_headers,
    )
    login = web_client.post("/api/auth/login", json={"username": "school_a", "password": "secret123"})
    school_headers = {"Authorization": f"Bearer {login.json()['token']}"}

    teacher = web_client.post(
        "/api/school/teachers",
        json={"username": "teacher_li", "password": "teacher123", "display_name": "Li", "subjects": ["数学"]},
        headers=school_headers,
    )
    assert teacher.status_code == 200
    teacher_id = teacher.json()["teacher"]["id"]

    klass = web_client.post(
        "/api/school/classes",
        json={"name": "高一1班", "grade": "高一", "subject_hint": "数学"},
        headers=school_headers,
    )
    assert klass.status_code == 200
    class_id = klass.json()["class"]["id"]

    students = web_client.post(
        "/api/school/students/import",
        json={"students": [{"student_no": "S001", "display_name": "Student One"}], "class_id": class_id},
        headers=school_headers,
    )
    assert students.status_code == 200
    assert students.json()["imported"] == 1

    assigned = web_client.post(
        "/api/school/teacher-class-assignments",
        json={"teacher_id": teacher_id, "class_id": class_id, "subject": "数学"},
        headers=school_headers,
    )
    assert assigned.status_code == 200
```

- [ ] **Step 2: Run school API tests and verify RED**

Run:

```powershell
.venv\Scripts\python.exe -m pytest tests/test_platform_school_api.py -q
```

Expected: 404 or import failure for school routes.

- [ ] **Step 3: Implement service and routes**

Backend enforcement:

- Admin-only: `GET /api/schools`, `POST /api/schools`, `POST /api/schools/{school_id}/school-users`.
- School-only: `GET /api/school/teachers`, `POST /api/school/teachers`, `POST /api/school/classes`, `POST /api/school/students/import`, `POST /api/school/teacher-class-assignments`.
- School users can only mutate rows in their own `school_id`.
- Teacher subject insertion replaces the teacher's current subjects.

- [ ] **Step 4: Run school API tests and selected auth tests**

Run:

```powershell
.venv\Scripts\python.exe -m pytest tests/test_platform_school_api.py tests/test_platform_auth_api.py -q
```

Expected: selected tests pass.

- [ ] **Step 5: Local checkpoint**

Run:

```powershell
git status --short
git diff --stat
```

Do not commit.

## Task 4: Frontend Auth API and Role Shells

**Files:**
- Create: `web/src/platform/auth.ts`
- Create: `web/src/platform/roles.ts`
- Create: `web/src/pages/platform/PlatformLogin.tsx`
- Create: `web/src/pages/platform/AdminWorkspace.tsx`
- Create: `web/src/pages/platform/SchoolWorkspace.tsx`
- Create: `web/src/pages/platform/TeacherWorkspace.tsx`
- Create: `web/src/pages/platform/StudentWorkspace.tsx`
- Modify: `web/src/App.tsx`
- Modify: `web/src/app/appPages.ts`

- [ ] **Step 1: Add frontend tests for pure role policy**

```typescript
import { describe, expect, it } from "vitest";
import { roleHomePage, canUseTeacherWorkspace } from "../roles";

describe("platform role policy", () => {
  it("maps roles to stable home pages", () => {
    expect(roleHomePage("admin")).toBe("admin");
    expect(roleHomePage("school")).toBe("school");
    expect(roleHomePage("teacher")).toBe("compose");
    expect(roleHomePage("student")).toBe("student");
  });

  it("only teachers and admins can use teacher workspace in phase 1", () => {
    expect(canUseTeacherWorkspace("teacher")).toBe(true);
    expect(canUseTeacherWorkspace("admin")).toBe(true);
    expect(canUseTeacherWorkspace("school")).toBe(false);
    expect(canUseTeacherWorkspace("student")).toBe(false);
  });
});
```

- [ ] **Step 2: Run role test and verify RED**

Run:

```powershell
cd web
npm.cmd test -- src/platform/__tests__/roles.test.ts
```

Expected: import failure for `../roles`.

- [ ] **Step 3: Implement frontend platform helpers and shell components**

`auth.ts` defines `PlatformRole`, `PlatformUser`, `PlatformStatus`, `PlatformAuthResponse`, `getPlatformStatus`, `getCurrentUser`, `bootstrapAdmin`, `loginPlatform`, `logoutPlatform`, `saveSessionToken`, `loadSessionToken`, and `clearSessionToken`.

`roles.ts` defines role labels, `roleHomePage`, and `canUseTeacherWorkspace`.

Shell pages must show usable phase-one surfaces:

- Admin: global AI provider entry point text plus school management section.
- School: AI toggle section and management lists for teachers/classes/students.
- Teacher: wraps the existing teacher workspace route set.
- Student: shows assigned papers/history empty states for Phase 1.

- [ ] **Step 4: Modify `App.tsx` role routing**

Behavior:

- If no project is open, keep existing WelcomePage behavior.
- If project is open and no admin exists, show `PlatformLogin` in bootstrap mode.
- If project is open and admin exists but no session exists, show login mode.
- If role is `admin`, show `AdminWorkspace`.
- If role is `school`, show `SchoolWorkspace`.
- If role is `student`, show `StudentWorkspace`.
- If role is `teacher`, show existing teacher workspace shell with a new Papers entry that renders an unavailable-state panel for Phase 1.

- [ ] **Step 5: Run frontend role tests**

Run:

```powershell
cd web
npm.cmd test -- src/platform/__tests__/roles.test.ts
```

Expected: role tests pass.

## Task 5: Verification

**Files:**
- No new implementation files.

- [ ] **Step 1: Run backend platform tests**

Run:

```powershell
.venv\Scripts\python.exe -m pytest tests/test_platform_auth_service.py tests/test_platform_auth_api.py tests/test_platform_school_api.py -q
```

Expected: all selected platform tests pass.

- [ ] **Step 2: Run existing backend smoke tests touched by project open/auth routing**

Run:

```powershell
.venv\Scripts\python.exe -m pytest tests/test_recent_projects_api.py tests/test_agent_llm_settings_api.py -q
```

Expected: selected existing tests pass.

- [ ] **Step 3: Run frontend build**

Run:

```powershell
cd web
npm.cmd run build
```

Expected: TypeScript and Vite build exit 0.

- [ ] **Step 4: Report local status**

Run:

```powershell
git status --short
git diff --stat
```

Expected: implementation files are uncommitted, and no commit/push has been performed.

