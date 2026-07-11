# Data Model

- Synced data is `Document` in `src-tauri/src/model.rs`, mirrored in `src/lib/tauri.ts`.
- Persisted per-device as a single-file SQLite database `tasks_<device>.db` (`src-tauri/src/db.rs`, rollback-journal mode so one file exists at rest — no `-wal`/`-shm` sidecars in the synced folder). Each entity is stored as its serde-JSON in a `data` column, so the model's backward-compat rules carry over with no SQL migration; the schema version is the DB's `PRAGMA user_version`.
- Legacy `tasks_<device>.json` / `tasks.json` are imported on first launch and left in place as a downgrade fallback. Desktop peers and Android SAF both merge sibling `tasks_*.db` (and legacy `tasks_*.json`) read-only with a `quick_check` guard; SAF push publishes this device's `.db` and mirrors `attachments_<device>/` (plus legacy flat `attachment_*`). Cross-device change detection hashes the decoded document (content), not file bytes, because two `.db` files with identical content are not byte-identical. Merge stays entity-level last-write-wins + tombstones in `model.rs`.
- `schemas/tasks.schema.json` describes the JSON serialization — now the migration/import and SAF-wire contract rather than the primary at-rest format.
- Device-local config is `config.json` in `src-tauri/src/config.rs`; settings and data-folder choice are not synced.
- Tasks reference tags through `tag_ids`; tags do not own tasks.
- Tags are flat and carry `priority`; task priority is derived from max tag weight.
- `Task.completed_at` is the source of truth for done and archived state.
- Templates live in `template_tasks`, not `tasks`.
- Views are computed from tasks/tags/templates, mainly in `src/state/indexes.ts`.
- Keep model changes backward-compatible with serde defaults, aliases, optional TS keys, schema updates, and tests.
