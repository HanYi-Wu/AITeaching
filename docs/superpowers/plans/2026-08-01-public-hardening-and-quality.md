# Public hardening and quality implementation plan

- [x] Record baseline Git state and preserve unrelated user changes.
- [x] Add failing security-policy tests for CORS, public-mode authentication, host-control authorization, and login rate limiting.
- [x] Implement a focused public-access module and wire it into FastAPI with lifespan startup.
- [x] Repair the three failing Python tests/dependency behavior and run the focused suite.
- [x] Align versions, license metadata, README/help documentation, CI, and ignore rules.
- [x] Add frontend translation/lazy-loading tests, then implement shell i18n and route splitting.
- [x] Add meaningful PrimeBrush core tests and run both Rust suites.
- [x] Run full Python/web/Rust verification and inspect production chunks.
- [x] Start the backend/frontend, validate the real browser flow, audit the existing FRP state, and report reachable addresses.
