## Why

The synced `Document` is currently persisted as a hand-parsed `tasks_<device>.json`
blob that is fully read, merged, and rewritten on every edit. As task volume grows
this whole-file rewrite is wasteful, offers no transactional integrity (a crash
mid-write relies on temp+rename alone), and makes partial queries impossible. Moving
the durable store to SQLite gives us transactions, indexing, and incremental writes —
while we must preserve the property that makes cross-device sync over Google Drive
conflict-free today: each device writes only its own replica file and never another's.

## What Changes

- Persist the synced `Document` in a per-device SQLite database instead of a JSON
  file. Each device owns exactly one replica, renamed `tasks_<device>.db`; a device
  still writes only its own replica and reads every peer replica read-only.
- Keep the working database in app-private local storage (WAL mode for fast,
  transactional writes) and publish a **checkpointed single-file snapshot**
  (`VACUUM INTO`) into the synced data folder on each debounced change, so Google
  Drive only ever sees a self-contained, transactionally-consistent `.db` file —
  never a live WAL database or its `-wal`/`-shm` sidecars. This unifies desktop with
  the master-plus-mirror model Android already uses.
- Merge peer replicas by decoding each `tasks_<device>.db` into a `Document` and
  running the **existing** entity-level last-write-wins + tombstone merge (time
  entries and attachments still union). Merge semantics are unchanged; only the
  serialization substrate changes.
- Migrate existing `tasks_<device>.json` (and legacy `tasks.json`) into SQLite on
  first launch, preserving all backward-compatible legacy-key folding, then leave the
  JSON file in place as a downgrade fallback.
- Store the schema version in the database (`user_version`) and keep the version gate:
  a replica written by a newer schema is refused, not silently downgraded.
- **BREAKING** (internal, not user-visible): the on-disk sync artifact changes from
  `tasks_<device>.json` to `tasks_<device>.db`. No task data or user-facing behavior
  changes; the JSON schema contract (`schemas/tasks.schema.json`) is retained only for
  migration/export.

### Non-goals

- Settings and the data-folder choice stay device-local in `config.json`; they do not
  move into SQLite.
- The per-device history sidecar (`history_<device>.jsonl`) stays a JSONL append log
  (already conflict-free and per-device); it is not folded into SQLite here.
- Attachment blobs stay files under `attachments_<device>/`; only their metadata lives
  in the document. No change to attachment storage.
- No change to the merge algorithm, conflict-resolution UX, or any active-view query.

## Capabilities

### New Capabilities
- `local-data-store`: the SQLite persistence layer — database schema and `user_version`,
  atomic transactional writes to a local WAL working DB, checkpointed single-file
  snapshot export for syncing, and one-time migration from the legacy JSON store.

### Modified Capabilities
- `multi-device-sync`: the per-device replica is now `tasks_<device>.db`; this device's
  writes publish a checkpointed snapshot rather than rewriting a JSON file, and the
  merge reads peer `.db` replicas. Entity-level merge, tombstones, conflict files, and
  the version gate are preserved.
- `android-folder-sync`: the SAF mirror pushes/pulls `tasks_<device>.db` snapshots (and
  reads peer `.db` replicas), never mirroring a live WAL database or its sidecars.

## Impact

- **Rust (`src-tauri/`)**: new `db`/store module (rusqlite + bundled SQLite); `store.rs`
  reworked to load/merge/persist via SQLite and emit snapshots; `config.rs`
  `data_file_name` → `.db`; `safsync.rs` mirrors `.db`; `sync.rs` watches for `.db`
  changes; migration path from JSON.
- **Dependencies**: add `rusqlite` (bundled SQLite) to `src-tauri/Cargo.toml`; verify the
  bundled build links for the `aarch64-linux-android` target.
- **Frontend (`src/`)**: none expected — the Tauri command surface and wire types are
  unchanged; the store swap is entirely behind the existing IPC.
- **Data/asset scope**: the attachment asset-protocol scope and data-folder relocation
  logic must cover the `.db` snapshot (and exclude the local WAL working DB from sync).
- **Tests**: merge, migration, snapshot round-trip, and version-gate tests; keep the
  JSON schema/round-trip tests for the migration path.
