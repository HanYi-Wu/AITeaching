# Agent File Intelligence and Teacher Capability Parity Implementation Plan


**Goal:** Support common teaching files end to end and give authenticated teachers complete AI coverage for ordinary content operations, with actionable manual guides for host-level risks.

**Architecture:** A central attachment registry owns upload and extraction behavior. Authenticated actor data is carried in `InvocationContext`; focused tool modules call existing domain services, while a capability manifest makes UI-to-AI parity testable. Existing guardrails remain the write/destructive confirmation boundary.

**Tech Stack:** FastAPI, Pydantic, openpyxl, xlrd, python-docx, python-pptx, pdfplumber, React/TypeScript, Vitest, pytest, Playwright CLI.

---

### Task 1: Central attachment registry and bounded extractors

**Files:**
- Create: `src/solaire/agent_layer/attachments.py`
- Create: `tests/test_agent_attachments.py`
- Modify: `pyproject.toml`
- Modify: `pixi.toml`
- Modify: `pixi.lock`

- [ ] **Step 1: Write failing registry and extraction tests**

Add tests that create real TXT, CSV, XLSX, XLS, DOCX, PPTX, PDF, and PNG fixtures. Assert `capability_for_filename()` classifies each format, `extract_attachment()` returns meaningful text for built-in formats, oversized ZIP expansion is rejected, and unknown `.exe` returns a conversion suggestion.

```python
def test_xlsx_extraction_returns_sheet_rows(tmp_path: Path) -> None:
    path = make_workbook(tmp_path / "知识梳理.xlsx")
    result = extract_attachment(path)
    assert result.kind == "spreadsheet"
    assert "一次函数" in result.content
    assert result.truncated is False
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `pixi run pytest tests/test_agent_attachments.py -q`

Expected: collection failure because `solaire.agent_layer.attachments` does not exist.

- [ ] **Step 3: Implement the registry and extractors**

Define `AttachmentCapability`, `AttachmentExtraction`, `SUPPORTED_UPLOAD_SUFFIXES`, `capability_for_filename(filename)`, and `extract_attachment(path, max_chars=40000)`. Use read-only parsers, `zipfile` expanded-size validation, bounded rows/pages/slides, and actionable `error`/`suggestion` fields. Add `xlrd`, `python-docx`, and `python-pptx` dependencies.

- [ ] **Step 4: Install and verify GREEN**

Run: `pixi install && pixi run pytest tests/test_agent_attachments.py -q`

Expected: all attachment tests pass.

### Task 2: Upload API, AI file reading, and frontend error fidelity

**Files:**
- Modify: `src/solaire/web/agent_api.py`
- Modify: `src/solaire/agent_layer/tools/file_tools.py`
- Modify: `src/solaire/agent_layer/tools/tool_definitions.py`
- Create: `web/src/components/agentUpload.ts`
- Create: `web/src/components/__tests__/agentUpload.test.ts`
- Modify: `web/src/components/AgentChatPanel.tsx`
- Modify: `web/src/i18n/locales/zh/agent.json`
- Modify: `web/src/i18n/locales/en/agent.json`
- Modify: `tests/test_agent_layer.py`

- [ ] **Step 1: Add failing upload and file-read tests**

Assert `.xlsx` upload returns 200, unsupported formats return structured `unsupported_file_type` detail, upload capabilities enumerate every accepted suffix, and `file.read` returns extracted workbook content rather than binary replacement characters.

```python
response = client.post("/api/agent/upload", files={"file": ("outline.xlsx", workbook, XLSX_MIME)})
assert response.status_code == 200
result = invoke_registered_tool("file.read", {"path": response.json()["path"]}, ctx)
assert "linear functions" in result.data["content"]
```

- [ ] **Step 2: Run tests and verify RED**

Run: `pixi run pytest tests/test_agent_layer.py tests/test_agent_attachments.py -q`

Expected: workbook upload is rejected and binary file reading is incorrect.

- [ ] **Step 3: Wire registry into API and tool**

Replace the route-local suffix set with the registry, add `GET /api/agent/upload-capabilities`, include extraction guidance in attachment prompt lines, and dispatch `file.read` through `extract_attachment()` for non-text formats.

- [ ] **Step 4: Add frontend helper and tests**

Define `AGENT_UPLOAD_ACCEPT` and `formatUploadFailure(name, error)` so nested FastAPI `detail.message` is preserved. Use the helper in `AgentChatPanel` and expose all accepted suffixes in the file input.

- [ ] **Step 5: Verify backend and frontend GREEN**

Run: `pixi run pytest tests/test_agent_layer.py tests/test_agent_attachments.py -q`

Run: `cd web && npm.cmd test -- --run src/components/__tests__/agentUpload.test.ts && npm.cmd run build`

Expected: tests and TypeScript production build pass.

### Task 3: Authenticated actor propagation and teacher graph isolation

**Files:**
- Modify: `src/solaire/agent_layer/models.py`
- Modify: `src/solaire/web/agent_api.py`
- Modify: `src/solaire/agent_layer/orchestrator.py`
- Modify: `src/solaire/agent_layer/tools/exam_tools.py`
- Modify: `src/solaire/agent_layer/tools/graph_tools.py`
- Create: `tests/test_agent_actor_scope.py`

- [ ] **Step 1: Write failing identity and isolation tests**

Create two teacher users and assert the chat request actor reaches tool context. Assert publishing uses the requesting teacher rather than the newest database teacher, and graph creation under teacher A is not visible under teacher B's scoped graph root.

- [ ] **Step 2: Run tests and verify RED**

Run: `pixi run pytest tests/test_agent_actor_scope.py -q`

Expected: actor is absent and the current `_platform_actor()` fallback chooses the wrong teacher.

- [ ] **Step 3: Propagate actor and scope graph tools**

Add `platform_user: dict[str, Any] | None` to `InvocationContext`, put the authenticated request user into `project_ctx`, construct the invocation context with that value, and replace arbitrary actor lookup with `ctx.platform_user`. Add a shared `teacher_graph_root(content_root, user)` helper and use it in both HTTP and agent graph operations.

- [ ] **Step 4: Verify GREEN and regression suite**

Run: `pixi run pytest tests/test_agent_actor_scope.py tests/test_agent_exam_export.py tests/test_graph_api.py tests/test_graph_service.py -q`

Expected: actor/isolation tests and existing graph/exam tests pass.

### Task 4: Teacher capability manifest and missing content tools

**Files:**
- Create: `src/solaire/agent_layer/teacher_capabilities.py`
- Create: `src/solaire/agent_layer/tools/teacher_tools.py`
- Modify: `src/solaire/agent_layer/tools/tool_definitions.py`
- Modify: `src/solaire/agent_layer/registry.py`
- Create: `tests/test_teacher_ai_capabilities.py`

- [ ] **Step 1: Write a failing parity test**

Create manifest entries for graph, bank, templates, exams, papers, analysis, settings, and project actions. The test must assert each `ai_tool` entry names a registered tool and each `manual_required` entry has at least three ordered steps plus prerequisites and a safety note.

```python
for capability in TEACHER_CAPABILITIES:
    if capability.mode == "ai_tool":
        assert capability.tool_name in registered_names
    else:
        assert len(capability.guide.steps) >= 3
```

- [ ] **Step 2: Run tests and verify RED**

Run: `pixi run pytest tests/test_teacher_ai_capabilities.py -q`

Expected: missing module or missing registered tools.

- [ ] **Step 3: Implement low-risk and confirmed content tools**

Register wrappers over existing services for graph rename/taxonomy/unbind/detach, bank item delete and collection rename/delete, template read/create/update/rename/delete, exam workspace list/get/save/delete/copy, and paper list/analysis/publications/submissions/delivery/publication update/revoke/manual grade. Use `ToolRisk.READ`, `WRITE`, and `DESTRUCTIVE` accurately and always use `ctx.platform_user` for platform data.

- [ ] **Step 4: Implement capability discovery and high-risk guides**

Register `teacher.list_capabilities` and `teacher.operation_guide`. Manual guides cover project directory control, extensions/TeX/OCR/conversion installation, API/provider credentials, arbitrary analysis scripts, opening host applications, and account credential changes.

- [ ] **Step 5: Verify parity and domain regressions**

Run: `pixi run pytest tests/test_teacher_ai_capabilities.py tests/test_bank_collection_rename_delete.py tests/test_template_web_integration.py tests/test_platform_paper_api.py -q`

Expected: parity and existing domain tests pass.

### Task 5: Demo school, teachers, and students

**Files:**
- Modify: `scripts/seed_demo_data.py`
- Create: `tests/test_seed_demo_accounts.py`

- [ ] **Step 1: Write failing idempotent seed test**

Run the account seeding twice against a temporary platform root. Assert exactly one demo school account, three teacher accounts, and five student accounts exist, all active and linked to the demo school/class, with no mandatory first-login password change.

- [ ] **Step 2: Run test and verify RED**

Run: `pixi run pytest tests/test_seed_demo_accounts.py -q`

Expected: only one teacher and two students exist.

- [ ] **Step 3: Generalize and extend the seed**

Use deterministic account definitions for `demo_school`, `demo_teacher`, `demo_teacher2`, `demo_teacher3`, and `demo_student` through `demo_student5`. Extract `seed_demo_accounts(platform_root)` for testability, assign every teacher to the class, and keep demo student `must_change_password=0`.

- [ ] **Step 4: Verify and seed the running environment**

Run: `pixi run pytest tests/test_seed_demo_accounts.py -q`

Run: `pixi run python scripts/seed_demo_data.py`

Expected: all nine requested accounts authenticate with the documented passwords.

### Task 6: Real AI and browser end-to-end verification

**Files:**
- Modify: `docs/plans/2026-08-01-agent-file-and-teacher-parity.md`
- Runtime artifacts only: `output/playwright/`, ignored upload/session data under `test/test/.solaire/`

- [ ] **Step 1: Run complete automated verification**

Run: `pixi run test`

Run: `cd web && npm.cmd test -- --run && npm.cmd run build && npm.cmd audit --audit-level=low --registry=https://registry.npmjs.org`

Run both Rust workspace test commands used by the repository.

- [ ] **Step 2: Restart the owned backend and preview processes**

Keep FastAPI on `127.0.0.1:8000`; keep Vite preview on `0.0.0.0:5173`; retain public authentication and the exact allowed host configuration.

- [ ] **Step 3: Exercise the reported workbook flow with real AI**

Log in as a seeded teacher, open Knowledge Graph, attach `知识梳理.xlsx`, ask the configured provider to create a disposable graph and nodes, verify visible graph data, ask AI to rename one node, then ask AI to delete it and accept the confirmation. Verify the final graph state through both UI and API and remove only the disposable test graph.

- [ ] **Step 4: Smoke-test all roles and inspect browser console**

Log in as the school account, one teacher, and one student. Verify each lands in the correct workspace. Confirm zero browser console errors during the teacher upload/AI/graph flow.

- [ ] **Step 5: Request code review, fix findings, and commit**

Review the implementation against this plan and design. Fix every critical/important issue, rerun the affected tests, mark all plan checkboxes complete, and commit the verified changes.
