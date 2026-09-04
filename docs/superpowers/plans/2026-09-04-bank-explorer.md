# Question explorer and screenshot fixes

**Goal:** Repair image/publication/preset usability and add persistent manual question folders.
**Architecture:** Teacher-workspace SQLite organization index, independent of question storage and publication snapshots; one shared service for API and AI. Accessible native disclosure tree in existing bank sidebar.
**Stack:** FastAPI, SQLite, React, Vitest, pytest.

- [ ] Image: exact screenshot marker regression in ResourceImage/StudentWorkspace tests, load/decode error feedback with retry; no tokens in image URLs.
- [ ] Publications: responsive record cards with visible labeled actions; existing pause/revoke confirmations remain.
- [ ] Presets: test empty template seeding and existing sections preservation, synchronize visual/YAML draft, show applied summary.
- [ ] Folders: test create/rename/remove/move, invalid paths, transaction rollback, isolation. GET /api/bank/folders and POST /api/bank/folders/actions share service with bank.organize tool.
- [ ] Explorer: nested disclosure folders, selectable/checkable questions, folder actions and batch move controls. Search/type/category filters remain applied to question visibility, folders persist when empty.
- [ ] Run targeted pytest/Vitest, production build and git diff --check; commit only scoped files. Do not claim remote upgrade without execution.
