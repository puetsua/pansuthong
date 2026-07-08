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

## 3. Store rework over SQLite

- [ ] 3.1 Rework `src-tauri/src/store.rs` `AppState` to hold a local WAL working DB (app-private path) instead of the JSON file, keeping the `read`/`write` closure API and IPC surface unchanged
- [ ] 3.2 Make each mutation a single transaction; on commit, mark the snapshot dirty
- [ ] 3.3 Implement checkpointed snapshot export via `VACUUM INTO '<data folder>/tasks_<device>.db'`, coalesced by the existing write debounce so at most one export runs per window
- [ ] 3.4 Ensure the working DB and its `-wal`/`-shm` sidecars are never created in the synced data folder
- [ ] 3.5 Tests: transactional write survives a simulated mid-write failure; snapshot is a single self-contained file with no sidecars

## 4. Migration from the JSON store

- [ ] 4.1 On store open with no working DB, import an existing `tasks_<device>.json` (or legacy `tasks.json`) through the existing parse/fold path into a fresh DB, then emit the first snapshot
- [ ] 4.2 Leave the original JSON file in place as a downgrade fallback; prefer the DB when both exist
- [ ] 4.3 Tests: legacy JSON (with legacy done/archived/scheduled keys) imports losslessly; existing DB is preferred and JSON is not re-imported

## 5. Multi-device sync integration

- [ ] 5.1 Update `src-tauri/src/config.rs` `data_file_name` to `tasks_<device>.db` (and add the app-private working-DB path resolver)
- [ ] 5.2 Update `read_merged_document`/replica discovery to enumerate peer `tasks_<device>.db` files, decode each to a `Document`, and feed the unchanged `merge_documents`
- [ ] 5.3 Read peers read-only/immutable with an integrity (`quick_check`) or version pre-check; skip a replica that fails and retry on the next tick (do not abort the merge)
- [ ] 5.4 Update `src-tauri/src/sync.rs` watcher/poll to react to `.db` snapshot changes in the folder
- [ ] 5.5 Confirm whole-document conflict-file detection/resolution (`conflict.rs`) still recognizes and handles `.db` conflict copies
- [ ] 5.6 Tests: two-device `.db` replica merge (LWW + tombstones + union), and a partially-written peer `.db` is skipped then merged once complete

## 6. Android SAF mirror

- [ ] 6.1 Update `src-tauri/src/safsync.rs` to push the `tasks_<device>.db` snapshot and pull peer `.db` replicas, never mirroring the live DB or `-wal`/`-shm` sidecars
- [ ] 6.2 Keep attachment and conflict-copy mirroring; resolved/dismissed conflicts are still removed from the SAF folder
- [ ] 6.3 Tests (desktop `SafBackend` fake): push writes only the `.db` snapshot (no sidecars); pull merges remote `.db` replicas

## 7. Data-folder relocation and asset scope

- [ ] 7.1 Ensure `set_data_folder`/`clear_data_folder` repoint the snapshot target and re-scan peer `.db` replicas, without moving the app-private working DB
- [ ] 7.2 Verify the attachment asset-protocol scope still covers the (now `.db`) data folder and excludes the local working DB

## 8. Verification and docs

- [ ] 8.1 Run the full Rust test suite and `cargo clippy` for both desktop and `aarch64-linux-android`
- [ ] 8.2 Manually verify a real two-device round-trip (PC dev app + Android dev app) syncing through a shared folder produces no conflict copies and merges edits both ways
- [ ] 8.3 Update `docs/agent/data-model.md`, `docs/agent/repo-map.md`, and `docs/agent/releases.md` (JSON→SQLite store, snapshot model, JSON-fallback retention window); keep `schemas/tasks.schema.json` documented as the migration/export contract
