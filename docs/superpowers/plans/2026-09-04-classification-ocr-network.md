# EducationHelper 1.5.2 Implementation Plan

**Goal:** Complete six requested usability/network fixes without deleting existing data.

**Architecture:** Keep one teacher question bank; store categories in question metadata. Reuse existing simple editors with sensible defaults and batch/manual shortcuts. Preserve old student credentials while adding short login identifiers. Serve exam images only through authorized student paper access. Reuse local Tesseract for image attachments. Application requests default to direct connections; installation proxy stays process-scoped and optional external proxy use is explicitly targeted.

**Stack:** FastAPI, React/Vite, Python, systemd/Bash, Sites release hosting.

## Tasks (execute inline, test each change before committing)

- [x] Inspect existing bank metadata, manual editors, login, media routes and OCR call chain.
- [x] Write failing regression cases for student-scoped image access, short student login and OCR attachment extraction; implement minimal fixes and run focused pytest.
- [x] Add bank category editor/filter and quick manual compose/template defaults; run focused Vitest and build.
- [x] Remove inherited process-wide proxy dependency; add explicit optional proxy routing for external AI requests and migrate Linux env safely. Test with unavailable proxy.
- [x] Add Ubuntu OCR installer (Tesseract + simplified Chinese/English data), validate actual engine/languages and connect automatic attachment extraction.
- [x] Additional request: batch question tool, cancellation safety, recoverable authorized deletion and deduplicated tool prompt descriptions.
- [ ] Align version 1.5.2, document behavior and limits, test/build, package and publish checked releases, provide upgrade and OCR script URLs.

## Acceptance

- Old users/data remain usable; no account password resets without authorization.
- Student images require assigned-paper authorization; no public arbitrary filesystem route.
- OCR absence/empty recognition produces an actionable error, never invented text.
- With 192.168.0.4 unavailable, local requests and directly reachable AI APIs still work.
- Linux installer tests cannot be called live-host verification; actual remote execution remains user-side.
