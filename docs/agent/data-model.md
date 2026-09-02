# Data Model

- Synced data is `Document` in `src-tauri/src/model.rs`, mirrored in `src/lib/tauri.ts`.
- Persisted per-device as a single-file SQLite database `tasks_<device>.db` (`src-tauri/src/db.rs`, rollback-journal mode so one file exists at rest — no `-wal`/`-shm` sidecars in the synced folder). Each entity is stored as its serde-JSON in a `data` column, so the model's backward-compat rules carry over with no SQL migration; the schema version is the DB's `PRAGMA user_version`.
- Legacy `tasks_<device>.json` / `tasks.json` are imported on first launch and left in place as a downgrade fallback. Desktop peers and Android SAF both merge sibling `tasks_*.db` (and legacy `tasks_*.json`) read-only with a `quick_check` guard; SAF push publishes this device's `.db` and mirrors `attachments_<device>/` (plus legacy flat `attachment_*`) and `history_<device>.jsonl`. On Android pull, the app-private master is updated with the same `merge_documents([local, …remotes])` path as desktop (no `.conflict-local-*` stash). Cross-device change detection hashes the decoded document (content), not file bytes, because two `.db` files with identical content are not byte-identical. Merge stays entity-level last-write-wins + tombstones in `model.rs`.
- `schemas/tasks.schema.json` describes the JSON serialization — now the migration/import and SAF-wire contract rather than the primary at-rest format.
- Device-local config is `config.json` in `src-tauri/src/config.rs`; settings and data-folder choice are not synced.
- Tasks reference tags through `tag_ids`; tags do not own tasks.
- Tags are flat and carry `priority`; task priority is derived from max tag weight.
- `Task.completed_at` is the source of truth for done and archived state.
- Templates live in `template_tasks`, not `tasks`.
- Views are computed from tasks/tags/templates, mainly in `src/state/indexes.ts`.
- Keep model changes backward-compatible with serde defaults, aliases, optional TS keys, schema updates, and tests.

## Three consistency models in the data folder

The sync folder holds three related kinds of data. They share device-id naming but
**do not** share one merge/delete protocol — do not treat a single `tasks_*.db` as
master for history or blobs.

| Kind | On disk | Cross-device behavior |
|------|---------|----------------------|
| Document (tasks/tags/templates) | `tasks_<device>.db` | Active merge (LWW + entity tombstones); UI uses the merged in-memory `Document` |
| History | `history_<device>.jsonl` | Append-only per device; read-time concat; peer merge does not append locally |
| Attachments | `attachments_<device>/` blobs + metadata in Document | Metadata LWW + `deleted_attachments` tombstones; blobs sync as files; local GC when unreferenced |

Shipped alignment (#120–#126): SAF mirrors `.db` + `attachments_<device>/` + `history_<device>.jsonl`; attachment tombstones/GC; peer-merge history append with dedup; atomic history append; history stays a JSONL sidecar (SQLite move not planned). The three kinds above still do not share one merge protocol — that split is intentional.
