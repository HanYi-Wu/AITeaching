# Agent File Intelligence and Teacher Capability Parity

## Goal

Make the teacher assistant reliably accept and understand common teaching files, then let an authenticated teacher use conversation to complete every ordinary content-management action available in the teacher UI. Operations that control the host, credentials, executable code, or local applications remain manual and must return a complete in-product procedure instead of a dead end.

## Root causes

The reported workbook upload fails at `POST /api/agent/upload`: `.xlsx` is absent from both the backend suffix allowlist and the frontend file input. Even if it were stored, `file.read` currently decodes every file as UTF-8, so ZIP-based Office documents become replacement-character garbage. The assistant also has gaps between teacher UI actions and registered tools, and platform-sensitive tools select an arbitrary recent teacher rather than the authenticated caller.

## Attachment architecture

Create a single backend attachment capability registry and extraction service. Upload validation, capability reporting, AI instructions, and file reading use the same registry.

Built-in AI-readable formats:

- Text and data: `.txt`, `.md`, `.yaml`, `.yml`, `.csv`, `.tsv`, `.json`, `.xml`, `.html`, `.htm`, `.rtf`.
- Spreadsheets: `.xlsx` with `openpyxl`, `.xls` with `xlrd`.
- Documents: `.docx` with `python-docx`, `.pdf` with `pdfplumber`.
- Presentations: `.pptx` with `python-pptx`.
- Images: `.png`, `.jpg`, `.jpeg`, `.webp`, `.bmp`, `.tif`, `.tiff`, `.gif`; OCR uses the configured Tesseract component.

Recognized legacy or convertible formats such as `.doc`, `.ppt`, `.odt`, `.ods`, and `.odp` may be uploaded, but the capability response must say that direct extraction requires the configured document-conversion component or conversion to the modern equivalent. Unknown formats are rejected with a structured error containing the extension, supported formats, and a concrete conversion suggestion. The frontend must display the backend reason.

Every extractor is bounded: 10 MiB upload, ZIP member and expanded-size checks, maximum sheet/page/slide counts, row/column limits, and a character budget with an explicit `truncated` flag. Formula cells are read as calculated values when available; files are never executed.

## Authenticated AI execution

The authenticated platform user is propagated from the request into `InvocationContext`. Platform tools must use that actor, never query for an arbitrary teacher. Knowledge-graph tools use the same teacher-scoped graph root as the HTTP graph API, so three teachers cannot mutate each other's private graphs through AI.

Uploaded attachments are described to the model with their exact extraction strategy. `file.read` handles built-in formats. For OCR or optional conversion, it returns an actionable result identifying the required component and the exact Settings path.

## Teacher capability matrix

Add a machine-checked manifest covering the teacher navigation surfaces:

- Knowledge graph: graph create/rename/delete/import/export; node and relation create/update/delete; taxonomy, bindings, and resource links.
- Question bank: search/get/create/update/delete; collection rename/delete; supported structured import/export guidance.
- Templates: list/read/create/update/rename/delete and preview.
- Exam workspace: list/get/create/update/delete, validate, export, and copy from an existing exam.
- Papers and grading: list/sync, delivery mode, publish, publication update/revoke, submissions, analysis, AI grading, and teacher-confirmed manual grading.
- Analysis: datasets, built-ins, diagnosis/remediation, and job status.
- Assistant memory and ordinary project-contained files.

Each manifest entry is either backed by a registered tool or explicitly classified as `manual_required` with a guide. Tests fail if an ordinary teacher action has neither.

Writes use the existing confirmation guardrail. Destructive content operations are registered as destructive and always require confirmation under normal safety modes.

The following stay manual even when requested in chat: selecting/opening/creating/closing host directories; installing extensions, TeX, OCR, or conversion programs; changing API keys/providers; running arbitrary scripts; opening generated files in host applications; and changing account credentials. The assistant exposes `teacher.operation_guide` with numbered UI steps, prerequisites, expected result, and safety note for each operation.

## Demo identities

The idempotent demo seed creates one school account, three teachers, and five students under one active school/class. Demo students do not require a first-login password change so every credential is immediately usable for end-to-end testing. All three teachers receive the class assignment.

## Verification

Use test-first development for extraction, error details, actor propagation, capability coverage, tools, and seeding. Verify the real browser flow with a generated workbook: upload, real configured AI read, graph creation, node generation, edit, delete with confirmation, and visible graph refresh. Log in with representative school, teacher, and student accounts. Finish with the full Python, frontend, build, audit, and Rust suites.
