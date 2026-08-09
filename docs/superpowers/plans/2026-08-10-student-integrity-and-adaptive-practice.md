# Student Integrity and Adaptive Practice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver reliable student answering, explainable anti-cheating telemetry, per-student historical wrong-question papers, and AI-generated 10-paper reinforcement practices.

**Architecture:** Extend attempts with frozen personalized question payloads while preserving the normal exam loader. Put history selection, wrong-answer extraction, AI generation, validation, and transactional publishing in one backend service shared by REST and teacher AI tools. Keep browser monitoring privacy-preserving and treat it as review evidence rather than an automatic cheating verdict.

**Tech Stack:** Python 3.11, FastAPI, SQLite, pytest, React 18, TypeScript, Tailwind CSS, Vitest/Testing Library, Playwright, existing OpenAI-compatible DeepSeek adapter.

---

### Task 1: Persist personalized attempts and correct proctor semantics

**Files:**
- Modify: `src/solaire/web/platform_db.py`
- Modify: `src/solaire/web/student_service.py`
- Modify: `src/solaire/web/paper_service.py`
- Test: `tests/test_platform_student_api.py`

- [ ] Add failing tests proving personalized payloads are returned/scored, saved answers resume, only visibility events consume the switch limit, invalid/duplicate events are rejected or deduplicated, and remaining time survives refresh.
- [ ] Run `pixi run pytest tests/test_platform_student_api.py -q` and confirm failures describe the missing behavior.
- [ ] Add migration-safe columns and helper functions for frozen questions, answer keys, existing answers, server-derived remaining time, event white-listing, rate de-duplication, and risk summaries.
- [ ] Re-run the focused tests and then existing paper-analysis tests.

### Task 2: Build adaptive publication service and API

**Files:**
- Create: `src/solaire/web/adaptive_practice_service.py`
- Modify: `src/solaire/web/paper_api.py`
- Test: `tests/test_adaptive_practice_api.py`

- [ ] Add failing API tests for history access, single-source wrong-question publishing, student isolation, zero-wrong skips, 10-publication eligibility, invalid source ownership, and atomic rejection of malformed AI output.
- [ ] Run `pixi run pytest tests/test_adaptive_practice_api.py -q` and confirm expected 404/422 failures.
- [ ] Implement history queries, frozen source extraction, strict generated-question validation, asynchronous DeepSeek generation, and a single transaction creating paper/publication/attempt records.
- [ ] Re-run adaptive and student API tests.

### Task 3: Associate teacher AI tools

**Files:**
- Modify: `src/solaire/agent_layer/tools/teacher_tools.py`
- Modify: `src/solaire/agent_layer/tools/tool_definitions.py`
- Modify: `src/solaire/agent_layer/teacher_capabilities.py`
- Test: `tests/test_teacher_ai_capabilities.py`
- Test: `tests/test_teacher_tools.py`

- [ ] Add failing tests asserting all three tools are registered, teacher-scoped, have correct risk levels, and call the same adaptive service as REST.
- [ ] Run the focused AI capability/tool tests and confirm registration failures.
- [ ] Register history, wrong-question publish, and reinforcement publish tools with schemas that require `class_id` and source publication IDs; reinforcement invokes the async service safely from the synchronous tool executor.
- [ ] Re-run focused tests.

### Task 4: Improve student answering and monitoring UI

**Files:**
- Modify: `web/src/platform/auth.ts`
- Modify: `web/src/pages/platform/StudentWorkspace.tsx`
- Test: `web/src/pages/platform/__tests__/StudentWorkspace.test.tsx`

- [ ] Add failing tests for resume data, server-derived countdown, unload-save without submit, autosave state, unanswered confirmation, question navigation/progress, and monitored event types.
- [ ] Run `npm.cmd test -- --run web/src/pages/platform/__tests__/StudentWorkspace.test.tsx` from `web` and confirm failures.
- [ ] Extend API types, restore saved answers, implement debounced/periodic save with visible state and retry, compute progress, add accessible navigation/confirmation, and send deduplicated browser integrity signals.
- [ ] Re-run the focused UI tests.

### Task 5: Add adaptive modes to teacher publish dialog

**Files:**
- Modify: `web/src/platform/auth.ts`
- Modify: `web/src/pages/ComposeWorkspace.tsx`
- Test: `web/src/pages/__tests__/ComposeWorkspace.test.tsx`

- [ ] Add failing tests for current/history/reinforcement tabs, history loading after class selection, single selection, 10+ multi-selection gate, and correct API payloads.
- [ ] Run the focused Compose tests and confirm failures.
- [ ] Add typed APIs and implement the three-mode dialog with eligibility/warning UI; special modes do not require the current draft’s template count, but retain class, time, submission and monitoring settings.
- [ ] Re-run focused tests.

### Task 6: Constrain AI response content

**Files:**
- Modify: `web/src/components/AgentChatPanel.tsx`
- Test: `web/src/components/__tests__/AgentChatPanel.test.tsx`

- [ ] Add a failing assertion that assistant prose is `min-w-0 max-w-full`, wraps long text, and horizontally scrolls only pre/table blocks.
- [ ] Run the focused test, change the content classes, and re-run it.

### Task 7: Full verification and runtime acceptance

**Files:**
- Modify only if failures expose a tested defect.

- [ ] Run full backend tests with `pixi run pytest -q`.
- [ ] Run frontend tests, `npm.cmd run build`, and `npm.cmd audit --audit-level=high` from `web`.
- [ ] Start/reuse backend and Vite bound to `0.0.0.0`; verify health through loopback and LAN address.
- [ ] Use the configured DeepSeek provider to generate a reinforcement practice from 10+ seeded history records and record provider/model/token evidence without exposing credentials.
- [ ] Use Playwright to log in as teacher, publish both practice kinds, log in as two students, prove question isolation/resume/submit/results, trigger integrity events, and inspect teacher analysis.
- [ ] Run an independent code review, fix high-confidence findings with regression tests, repeat affected suites, and commit the final branch.
