# Admin Operations And Linux Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make administrator AI configuration and extension management operational, replace the cramped sidebar layout, and ship a safe one-command Linux upgrade for EducationHelper 1.5.1.

**Architecture:** Public access gains an admin-configuration tier separate from host control. The admin React workspace becomes section-based, AI settings receive an authenticated server-side connection probe, and extension detection returns platform-specific guidance. Release metadata drives a checksum-verified, health-checked, rollback-capable Linux upgrader.

**Tech Stack:** FastAPI, pytest, React, TypeScript, Vitest, Testing Library, Bash, systemd, Sites static hosting.

---

### Task 1: Administrator configuration authorization

**Files:**
- Modify: `src/solaire/web/public_access.py`
- Test: `tests/test_public_access_security.py`

- [ ] Add failing public-mode tests proving an authenticated admin may write AI settings and extension preferences without a control token while teachers are denied.
- [ ] Run `pixi run pytest tests/test_public_access_security.py -q` and confirm the admin cases fail with 403.
- [ ] Add an admin-configuration path classifier and enforce the administrator role separately from host control.
- [ ] Re-run the security test and confirm all cases pass.
- [ ] Commit the authorization fix and tests.

### Task 2: AI save verification and connection test

**Files:**
- Modify: `src/solaire/web/agent_api.py`
- Modify: `web/src/api/client.ts`
- Modify: `web/src/components/settings/AgentModelSettingsForm.tsx`
- Test: `tests/test_agent_api.py`
- Test: `web/src/components/settings/AgentModelSettingsForm.test.tsx`

- [ ] Add failing backend tests for configured, unconfigured, and failed AI connection probes.
- [ ] Implement `POST /api/agent/llm-settings/test` using the effective server-side settings and a minimal provider call with sanitized errors.
- [ ] Add failing component tests for save confirmation, effective-config reload, and the test-connection button.
- [ ] Add the typed client call and UI status panel, then run the focused backend and frontend tests.
- [ ] Commit the working AI configuration flow.

### Task 3: Admin workspace layout

**Files:**
- Modify: `web/src/pages/platform/AdminWorkspace.tsx`
- Test: `web/src/pages/platform/__tests__/AdminWorkspace.test.tsx`

- [ ] Add a failing test for the three full-width workspace tabs and default school section.
- [ ] Replace the fixed 440px sidebar with accessible section navigation and bounded content panels.
- [ ] Verify keyboard navigation, narrow viewport structure, and the focused component test.
- [ ] Commit the layout change.

### Task 4: Platform-aware extension workflow

**Files:**
- Modify: `src/solaire/web/extension_registry.py`
- Modify: `src/solaire/web/app.py`
- Modify: `web/src/components/ExtensionsPanel.tsx`
- Test: `tests/test_extension_api.py`
- Test: `web/src/components/ExtensionsPanel.test.tsx`

- [ ] Add failing tests for Linux installation guidance, Windows confirmation metadata, and admin-only mutation access.
- [ ] Return platform and per-extension install guidance without invoking sudo on Linux.
- [ ] Update the UI to confirm Windows winget launches, copy Linux commands, and recheck detection.
- [ ] Run focused backend and frontend extension tests.
- [ ] Commit the extension workflow.

### Task 5: One-command Linux upgrade

**Files:**
- Create: `scripts/upgrade-linux.sh`
- Create: `scripts/test-upgrade-linux.sh`
- Modify: `scripts/deploy-linux.sh`
- Modify: `product-site/public/releases/deploy-linux.sh`
- Create: `product-site/public/releases/upgrade-linux.sh`
- Create: `product-site/public/releases/latest-linux.json`

- [ ] Write shell acceptance cases for checksum rejection, successful link switch, preserved data, and health-check rollback.
- [ ] Run the test script and confirm it fails before the upgrader exists.
- [ ] Implement release-manifest download, SHA-256 verification, versioned extraction, service restart, health check, and rollback.
- [ ] Run deployment and upgrade shell tests to completion.
- [ ] Commit upgrade tooling.

### Task 6: Release 1.5.1 and publish after local verification

**Files:**
- Modify: all existing version metadata files covered by `tests/test_repository_metadata.py`
- Modify: `docs/CHANGELOG.md`
- Modify: `product-site/public/releases/versions.json`
- Modify: `product-site/public/releases/SHA256SUMS.txt`
- Create: `product-site/public/releases/EducationHelper-1.5.1-linux-source.tar.gz`

- [ ] Update all repository version declarations to 1.5.1 and record only verified changes in the changelog.
- [ ] Run focused tests, full backend tests, full frontend tests, production build, shell tests, metadata tests, and `git diff --check`.
- [ ] Build the source archive from tracked release content and update checksums plus latest metadata.
- [ ] Re-run archive and upgrade tests against the final artifacts.
- [ ] Commit the release, push master, deploy the Sites download page, and verify the public manifest and scripts before giving the remote command.
