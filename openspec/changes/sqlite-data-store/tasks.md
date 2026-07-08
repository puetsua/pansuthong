## 1. Dependency and Android link gate

- [x] 1.1 Add `rusqlite` with the `bundled` feature to `src-tauri/Cargo.toml`
- [x] 1.2 Add a trivial `rusqlite::Connection::open_in_memory` call behind a test and confirm `cargo test` builds on desktop
- [x] 1.3 GATE: verify the bundled SQLite links for Android with `cargo check --target aarch64-linux-android` and `cargo clippy --target aarch64-linux-android` (CI does not build Android); resolve any C/link issues before proceeding

## 2. Database module and schema

- [x] 2.1 Create `src-tauri/src/db.rs`: open a connection, set WAL mode, and initialize schema (entity tables `tasks`/`tags`/`templates` shaped `(id PK, edit_stamp INTEGER, deleted_at INTEGER NULL, data TEXT)`, a `meta` table for document-level fields, and `PRAGMA user_version = CURRENT_VERSION`)
- [x] 2.2 Implement `Document -> DB` write (encode each entity as serde-JSON into `data`, promote `edit_stamp`/`deleted_at` to columns) inside a single transaction
- [x] 2.3 Implement `DB -> Document` read that reconstructs the exact `Document` (including tombstones, time entries, attachment metadata)
- [x] 2.4 Implement the `user_version` gate: refuse to read a DB whose `user_version` exceeds `CURRENT_VERSION`, returning the existing "update the app" error
- [x] 2.5 Unit tests: `Document` round-trip equality, new optional-field back-compat (no migration needed), and version-gate rejection

> **Design note (D3a):** implemented as a single-file rollback-journal store (one
> `tasks_<device>.db` at rest, no `-wal`/`-shm` sidecars) rather than the working-DB +
> `VACUUM INTO` snapshot split. Delivered **desktop-first**; the Android SAF layer
> (group 6) still exchanges JSON and is a follow-up requiring on-device testing.

## 3. Store rework over SQLite

- [x] 3.1 Rework `src-tauri/src/store.rs` `AppState` to persist via SQLite (single-file `tasks_<device>.db`, `DELETE` journal), keeping the `read`/`write` closure API and IPC surface unchanged
- [x] 3.2 Make each mutation a single transaction (`db::write_document`)
- [~] 3.3 ~~Checkpointed `VACUUM INTO` snapshot export~~ — superseded by D3a (single-file store; `db::snapshot` helper kept for the deferred split fallback)
- [x] 3.4 Ensure no `-wal`/`-shm` sidecars are created in the data folder (rollback-journal mode)
- [x] 3.5 Tests: write persists across reopen; content-hash change-detection settles after a peer merge

## 4. Migration from the JSON store

- [x] 4.1 On store open with no database, import an existing `tasks_<device>.json` (or legacy `tasks.json`) through the existing parse/fold path into the DB
- [x] 4.2 Leave the original JSON file in place as a downgrade fallback; prefer the DB when both exist
- [x] 4.3 Tests: legacy JSON imports; peer `.db` + `.json` replicas merge on open

## 5. Multi-device sync integration

- [x] 5.1 Update `src-tauri/src/config.rs` `data_file_name` to `tasks_<device>.db`
- [x] 5.2 Replica discovery enumerates peer `tasks_<device>.db` (and legacy `.json`), decodes each to a `Document`, and feeds the unchanged `merge_documents`
- [x] 5.3 Read peers read-only/immutable with a `quick_check` integrity pre-check; skip a replica that fails and retry on the next tick (do not abort the merge)
- [x] 5.4 `src-tauri/src/sync.rs` watcher/poll reacts to folder changes (content-hash based; path-agnostic)
- [x] 5.5 Confirm conflict copies stay JSON so `conflict.rs`/`scan_conflict_files` are unchanged and still work
- [x] 5.6 Tests: peer `.db`/`.json` merge, reload picks up a new peer then settles, bad peer replica skipped

## 6. Android SAF mirror — DEFERRED (needs on-device testing)

- [ ] 6.1 Update `src-tauri/src/safsync.rs` to push/pull `tasks_<device>.db` replicas over SAF (currently still JSON; PC↔Android interop lands here)
- [ ] 6.2 Keep attachment and conflict-copy mirroring; resolved/dismissed conflicts still removed from the SAF folder
- [ ] 6.3 Tests (desktop `SafBackend` fake): push/pull with `.db` replicas

## 7. Data-folder relocation and asset scope

- [x] 7.1 `set_data_folder`/`clear_data_folder` repoint the store (`repoint`) and re-scan peer replicas
- [x] 7.2 Attachment asset-protocol scope unchanged (attachments still under the data folder; single-file store adds no separate working-DB path)

## 8. Verification and docs

- [~] 8.1 Desktop: full test suite (156/156) + `cargo clippy` clean; `aarch64-linux-android` `cargo check` clean. (Android clippy/tests not run here)
- [ ] 8.2 Manually verify a real two-device round-trip (two PC instances via a shared folder; PC↔Android after group 6) produces no conflict copies and merges edits both ways
- [ ] 8.3 Update `docs/agent/data-model.md`, `docs/agent/repo-map.md`, and `docs/agent/releases.md` (JSON→SQLite store, single-file model, JSON-fallback retention); keep `schemas/tasks.schema.json` documented as the migration/export contract
