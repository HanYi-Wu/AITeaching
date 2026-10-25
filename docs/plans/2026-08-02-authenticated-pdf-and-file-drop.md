# Authenticated PDF Preview and Teacher File Drop Implementation Plan


**Goal:** Make protected PDF previews authenticate correctly and let teachers drag files anywhere over the AI assistant for immediate use.

**Architecture:** Fetch PDF bytes through the existing authenticated API client and pass a short-lived object URL to PDF.js. Extend the existing assistant attachment pipeline with panel-level drag state and a file-only default instruction, without adding a second upload subsystem.

**Tech Stack:** React 18, TypeScript, react-pdf/PDF.js, Vitest, Testing Library, FastAPI public-mode authentication.

---

### Task 1: Authenticated PDF bytes

**Files:**
- Modify: `web/src/api/client.ts`
- Modify: `web/src/api/client.test.ts`
- Modify: `web/src/components/PdfPreview.tsx`
- Create: `web/src/components/__tests__/PdfPreview.test.tsx`

- [ ] Add a client test asserting a PDF blob request carries `Authorization: Bearer <platform token>`.
- [ ] Run `npm.cmd test -- src/api/client.test.ts` and confirm it fails because the blob helper does not exist.
- [ ] Implement `apiGetBlob(path)` through `fetchWithLog`.
- [ ] Add a component test asserting `PdfPreview` creates and later revokes an object URL.
- [ ] Change `PdfPreview` to fetch a blob and manage the object URL lifecycle.
- [ ] Run both focused tests and confirm they pass.

### Task 2: Panel-wide file drop and file-only submission

**Files:**
- Modify: `web/src/components/agentUpload.ts`
- Modify: `web/src/components/__tests__/agentUpload.test.ts`
- Modify: `web/src/components/AgentChatPanel.tsx`
- Modify: `web/src/i18n/locales/zh/agent.json`
- Modify: `web/src/i18n/locales/en/agent.json`

- [ ] Add failing helper tests for detecting file drags, merging dropped files, and producing a default instruction for file-only sends.
- [ ] Run `npm.cmd test -- src/components/__tests__/agentUpload.test.ts` and confirm the new expectations fail.
- [ ] Implement focused drag/drop helpers in `agentUpload.ts`.
- [ ] Add depth-counted drag handlers and a drop overlay to the assistant panel.
- [ ] Permit file-only sends and use a localized default processing instruction.
- [ ] Run the focused tests and confirm they pass.

### Task 3: Full verification and delivery

**Files:**
- Verify all files changed above.

- [ ] Run `pixi run test` and confirm the Python suite has zero failures.
- [ ] Run `npm.cmd test`, `npm.cmd run build`, and `npm.cmd audit --audit-level=low` under `web/`.
- [ ] Restart the public-mode backend and `0.0.0.0` frontend.
- [ ] Use a real teacher login to verify the protected PDF preview renders without 401.
- [ ] Drag a supported file into the full assistant panel and verify it becomes an attachment and can be sent without typed text.
- [ ] Run `git diff --check`, commit the implementation, and report the reachable LAN address.

