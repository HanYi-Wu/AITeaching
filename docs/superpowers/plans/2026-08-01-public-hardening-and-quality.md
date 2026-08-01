# Public hardening and quality implementation plan

- [ ] Record baseline Git state and preserve unrelated user changes.
- [ ] Add failing security-policy tests for CORS, public-mode authentication, host-control authorization, and login rate limiting.
- [ ] Implement a focused public-access module and wire it into FastAPI with lifespan startup.
- [ ] Repair the three failing Python tests/dependency behavior and run the focused suite.
- [ ] Align versions, license metadata, README/help documentation, CI, and ignore rules.
- [ ] Add frontend translation/lazy-loading tests, then implement shell i18n and route splitting.
- [ ] Add meaningful PrimeBrush core tests and run both Rust suites.
- [ ] Run full Python/web/Rust verification and inspect production chunks.
- [ ] Start the backend/frontend, validate the real browser flow, recover the existing FRP tunnel, and report reachable addresses.
