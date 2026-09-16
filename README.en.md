# EducationHelper (EH)

EducationHelper is a school teaching and assessment application with a React web interface, Python/FastAPI backend, AI tools, and an optional Tauri desktop shell. Current source version: **1.5.4**.

See the [Chinese README](README.md) for the maintained setup guide and [release notes](src/solaire/web/assets/help_docs/changelog.md) for version history.

## Capabilities

School and account administration, question editing/import, exam composition, online assignments, student answers and image uploads, teacher grading, offline scan collection, remedial practice, reports, and AI-assisted workflows.

Teachers must review OCR and AI grading suggestions. Browser activity events assist review and cannot establish that cheating did or did not occur. Question files, images and new question exports are teacher-specific, including AI file access. Existing teachers receive independent copies of the unowned legacy shared bank; newly created teachers start empty. Original files remain for historical exams. Back up before updating; see [migration notes](docs/release-1.5.4.md).

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
