## ADDED Requirements

### Requirement: SQLite durable store

The system SHALL persist the synced `Document` (tasks, tags, templates, tombstones,
and document-level fields) in a SQLite database, round-tripping every entity through
the Rust model so no field is lost or reshaped versus the prior JSON store.

#### Scenario: Document round-trips through SQLite
- **WHEN** a `Document` is written to the database and read back
- **THEN** the reconstructed `Document` equals the original, including tombstones, time
  entries, and attachment metadata

#### Scenario: Model back-compat carries over
- **WHEN** a newly added optional model field is serialized into the store
- **THEN** it persists and reloads without a schema migration, because entities are stored
  as their serialized model shape

### Requirement: Transactional incremental writes

The system SHALL apply each mutation to the working database in a single transaction, so
a crash mid-write can never leave a partially applied edit.

#### Scenario: A crash mid-write leaves the last committed state
- **WHEN** the process is killed during a write
- **THEN** on next open the database reflects either the fully committed edit or the prior
  state, never a partial row

### Requirement: Local working database excluded from sync

The system SHALL keep the working database (WAL mode) in app-private local storage and
never place the live database or its `-wal`/`-shm` sidecar files in the synced data folder.

#### Scenario: Sidecars never reach the sync folder
- **WHEN** the store is writing in WAL mode
- **THEN** no `-wal` or `-shm` file appears in the synced data folder

### Requirement: Checkpointed snapshot export

The system SHALL publish this device's replica as a single self-contained, transactionally
consistent snapshot file (`tasks_<device>.db`) into the synced data folder, produced by a
checkpointing single-file export, coalesced by the existing write debounce.

#### Scenario: Snapshot is a clean single file
- **WHEN** a snapshot is exported after a change
- **THEN** the snapshot in the synced folder is a complete database with no attached WAL,
  reflecting all committed edits up to that point

#### Scenario: Rapid edits coalesce into one snapshot per debounce
- **WHEN** several edits land within the write-debounce window
- **THEN** at most one snapshot export runs for that window

### Requirement: Schema version gate

The system SHALL record the schema version in the database (`user_version`) and refuse to
load a database or snapshot whose version exceeds the running build's supported version,
surfacing an "update the app" condition rather than downgrading it.

#### Scenario: Newer database is refused, not downgraded
- **WHEN** a replica or snapshot declares a `user_version` higher than the build supports
- **THEN** it is rejected rather than decoded and rewritten with unknown data dropped

### Requirement: Migration from the JSON store

The system SHALL, on first launch without a working database, import an existing
`tasks_<device>.json` (or legacy `tasks.json`) through the existing parse-and-fold path,
preserving all backward-compatible legacy keys, and leave the JSON file in place as a
downgrade fallback.

#### Scenario: Legacy JSON is imported once
- **WHEN** the app starts with a legacy JSON replica but no database
- **THEN** the JSON is decoded (folding legacy keys) into a new database and the original
  JSON file is left untouched

#### Scenario: Existing database is preferred over JSON
- **WHEN** both a working database and a legacy JSON replica exist
- **THEN** the database is used and the JSON is not re-imported
