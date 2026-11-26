# EducationHelper (EH)

OriginReach is a school teaching and assessment application with a React web interface, Python/FastAPI backend, AI tools, and an optional Tauri desktop shell. Current source version: **1.8.0**.

Version 1.8.0 updates the floating AI assistant and teacher workspace, adds individual wrong-answer practice, and introduces signed update tooling. See the [1.8.0 release notes](docs/release-1.8.0.md).

Version 1.7.2 adds goal-based auto-composition, multi-dimensional duplicate checking, granular school management permissions and audit heatmaps, alongside comprehensive frontend and backend performance and mobile usability optimizations. See the [1.7.2 release notes](docs/release-1.7.2.md).

Version 1.7.1 unifies in-app dropdowns and interactions, improves desktop, tablet and mobile layouts, and fixes question-bank conflict feedback, compose state and demo data. See the [1.7.1 release notes](docs/release-1.7.1.md).

Version 1.7.0 adds recoverable exports and editing drafts, unified task status, and practice progress comparisons. It improves question editing, publication, student answers, grading, report processing, document conversion, and large-workspace interaction, while fixing concurrent saves, stale responses, and historical class display. See the [1.7.0 release notes](docs/release-1.7.0.md).

Version 1.6.6 adds personal practice assignment, one-assignment-per-student paper folders, content folders and tags, and exam-local question-count overrides. See the in-app changelog for details.

Version 1.6.1 resolves permission errors (403 No permission for this paper) during exam-to-paper conversion and direct paper publishing in multi-teacher setups, standardizing paper claim and read-only query isolation. See [1.6.1 release notes](docs/release-1.6.1.md).

Version 1.6.0 fixes permission errors when teachers create, rename, or copy exam workspaces while preserving teacher isolation and duplicate-name protection. See [1.6.0 release notes](docs/release-1.6.0.md).

Version 1.5.6 adds nested-folder drag moves and cut/paste, seven-day snapshot invitations including images, teacher-editable alternative/AND/OR answers, and persisted first-use guidance after changing an initial teacher password. Invitation holders can copy the shared snapshot; revoke unused invitations when needed. See [release notes](docs/release-1.5.6.md).

See the [Chinese README](README.md) for the maintained setup guide and [release notes](src/solaire/web/assets/help_docs/changelog.md) for version history.

## Capabilities

School and account administration, question editing/import, exam composition, online assignments, student answers and image uploads, teacher grading, offline scan collection, remedial practice, reports, and AI-assisted workflows.

Teachers must review OCR and AI grading suggestions. Fully objective online exams release results automatically; mixed exams require teacher review. Browser activity events cannot prove or disprove cheating. New banks and exports are teacher-specific, including AI file access. Version 1.5.5 quarantines unchanged, unattributed legacy copies without deleting originals, newly authored questions or teacher edits. Administrators must verify ownership before restoring quarantined questions. See [migration notes](docs/release-1.5.5.md).

## Development

Use Python 3.12 and Node.js 20. From the repository root, install the Python package with `python -m pip install -e ".[dev,primebrush-pdf]"`; run `npm ci` in `web`.

Start the backend from the repository root:

```bash
python -m uvicorn solaire.web.app:app --app-dir src --host 127.0.0.1 --port 8000
```

In another terminal, from `web`:

```bash
npm run dev -- --host 0.0.0.0 --port 5173
```

Open `http://127.0.0.1:5173` and initialize an administrator. No universal account password is supplied. LaTeX PDF generation requires a TeX installation; OCR requires Tesseract and language data.

Run `python -m pytest tests`, then `npm test` and `npm run build` in `web`. Rust tests run with `cargo test --workspace` in `primebrush-rs`.

## Deployment

See [Linux update instructions](docs/release-1.5.3.md). Existing deployments keep data and configuration outside the release directory. Windows and Linux AI credentials are configured separately. AI traffic is direct unless its exact hostname is opted into the configured proxy.

The historical online installer may target an older published archive; consult its manifest instead of assuming it matches the current branch. Verify the GitHub Actions run for the exact commit you deploy.

## License

Custom non-commercial license. Retain author attribution and project origin; commercial use requires written authorization. See [LICENSE](LICENSE).
