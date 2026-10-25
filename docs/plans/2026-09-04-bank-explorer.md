# Question explorer and screenshot fixes

**Goal:** Repair image/publication/preset usability and add persistent manual question folders.
**Architecture:** Teacher-workspace SQLite organization index, independent of question storage and publication snapshots; one shared service for API and AI. Accessible native disclosure tree in existing bank sidebar.
**Stack:** FastAPI, SQLite, React, Vitest, pytest.

- [x] Image: exact screenshot marker regression in ResourceImage/StudentWorkspace tests, load/decode error feedback with retry; no tokens in image URLs.
- [x] Publications: responsive record cards with visible labeled actions; existing pause/revoke confirmations remain.
- [x] Presets: empty template seeding and existing sections preservation, show applied summary. Controls are only in visual mode; existing YAML serialization remains used by save.
- [x] Folders: create/rename/remove/move, invalid paths, transaction rollback, teacher isolation. GET /api/bank/folders and POST /api/bank/folders/actions share service with bank.organize tool.
- [x] Explorer: nested disclosure folders, selectable/checkable questions, folder actions and batch move controls. Search/type/category filters remain applied to question visibility, folders persist when empty.
- [x] Targeted tests: 20 backend / 28 frontend passed; production build and git diff --check passed. Scoped commits created.

Local backend restart was denied by execution policy before execution; new directory API still requires restart. Remote Linux and Sites not updated. Existing app data binding must be preserved during restart.
