# Public access hardening and quality design

## Goal

Make SolEdu safe enough for an FRP-backed test deployment, resolve the audited test/documentation/version defects, reduce the initial frontend bundle, and leave a repeatable verification path without rewriting the existing application.

## Deployment boundary

- Vite is the only process bound to `0.0.0.0`; FastAPI stays on `127.0.0.1` and is reached through Vite's same-origin `/api` proxy.
- CORS uses an explicit environment-driven origin allow-list. Wildcard origins and credentialed wildcard requests are forbidden.
- In public mode, every non-public `/api` request requires a valid platform session.
- Public endpoints are limited to health, platform status, login, and one-time administrator bootstrap.
- Login/bootstrap attempts are rate-limited in memory by client address. This protects a single-process test deployment without introducing a new service.
- Host-control routes (project binding/recent paths, native file dialogs, extension installation/manual paths, and opening files on the host) require both an administrator session and `X-Solaire-Control-Token` matching a startup secret. They are not usable through the ordinary remote browser.
- Normal authenticated teacher/school/student workflows remain usable over FRP. Existing role checks in the platform routers remain authoritative.

## Compatibility

- Public hardening is enabled with `SOLAIRE_PUBLIC_MODE=1`; the existing local desktop workflow remains compatible by default.
- `SOLAIRE_CONTROL_TOKEN` is mandatory for host-control operations in public mode and is never written into frontend assets.
- `SOLAIRE_ALLOWED_ORIGINS` accepts a comma-separated list for deployments that intentionally use cross-origin clients. Same-origin FRP access does not require CORS.
- A project can be pre-bound with the existing `SOLAIRE_PROJECT_ROOT` and `SOLAIRE_BIND_PROJECT_FROM_ENV=1`, avoiding remote project-selection operations.

## Quality changes

- Repair the two remediation API tests so they assert the current response envelope and create the requested exam path.
- Make the optional CairoSVG test skip cleanly when the native Cairo runtime is unavailable; document/add the native dependency in the managed Pixi environment.
- Replace FastAPI's deprecated startup event with a lifespan handler.
- Align application-visible versions on `0.2.3` and align license metadata/documentation with the repository's custom noncommercial license.
- Correct broken README links/contact information and provide an English README.
- Ignore newly generated local output/test workspace artifacts while preserving the user's existing dirty files.

## Frontend changes

- Replace the audited visible hard-coded shell strings with `app` namespace translations.
- Convert major workspaces/routes to `React.lazy` with a translated suspense fallback.
- Keep route component props and current navigation behavior unchanged so the optimization is incremental.
- Add focused UI tests for translated shell behavior and retain the existing frontend suite/build as regression checks.

## Verification

- Python: focused red/green tests, then the complete pytest suite.
- Web: Vitest, TypeScript/build, and bundle-size inspection.
- Rust: PrimeBrush workspace and Tauri tests, with focused core tests added where behavior is testable without a GUI.
- Runtime: launch backend on loopback and Vite on `0.0.0.0`, verify CORS/auth/host-control policies, then exercise login and a representative page in a real browser.
- FRP: reuse the previously configured `frp-van.com` tunnel if its local launcher/config can be recovered; otherwise the LAN URL remains available and the missing external launcher is reported as the sole external-state blocker.
