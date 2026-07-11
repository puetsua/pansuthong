# multi-device-sync Specification

## Purpose

Pansutong syncs by placing each device's data file in a shared cloud folder
(e.g. Google Drive) as a per-device replica (`tasks_<device>.json`). The app never
writes another device's replica; instead it reads all replicas and computes a
merged document with entity-level last-write-wins plus tombstones. A filesystem
watcher and a polling fallback pick up changes pulled in from other devices, and a
whole-document divergence path preserves the loser as a conflict file.

## Requirements

### Requirement: Per-device replicas

The system SHALL write only this device's replica, named from its stable
`device_id`, and never modify another device's replica file.

#### Scenario: Each device owns its file
- **WHEN** two devices sync into the same folder
- **THEN** each writes only its own `tasks_<device>.json` and reads the others read-only

### Requirement: Entity-level merge

The system SHALL compute the visible document by merging all replicas with
last-write-wins per entity (task/tag/template) keyed by its edit stamp, applying
tombstones so a deleted entity is not resurrected by a stale replica.

#### Scenario: Newer edit wins
- **WHEN** two replicas carry different versions of the same task
- **THEN** the one with the greater edit stamp wins the fields (time entries and attachments still union)

#### Scenario: Tombstone suppresses a stale entity
- **WHEN** one replica deleted an entity (tombstone) and another still has an older copy
- **THEN** the merged document omits it

### Requirement: Watcher and polling fallback

The system SHALL detect data-file changes via a filesystem watcher and also poll
periodically, because native FS events are unreliable on cloud-sync folders.

#### Scenario: Manual sync re-reads immediately
- **WHEN** `sync_now` is invoked
- **THEN** the data file is re-read at once and, if changed, a store-changed event is emitted

### Requirement: Whole-document conflict files

The system SHALL preserve a divergent whole-document copy as a recognizable
conflict file rather than silently discarding it.

#### Scenario: Conflict badge lists divergences
- **WHEN** conflict copies exist in the data folder
- **THEN** `list_conflicts` returns them and a conflicts-detected event surfaces the badge

### Requirement: Conflict resolution

The system SHALL let the user review per-task differences from a conflict file and
apply keep-mine/keep-theirs decisions, merging in referenced tags so they do not
dangle, then remove the resolved conflict file.

#### Scenario: Only vetted conflict paths are touched
- **WHEN** a conflict path is not one produced by `list_conflicts` in the data directory
- **THEN** read/resolve/dismiss reject it rather than touching an arbitrary file

#### Scenario: Resolving applies decisions and clears the file
- **WHEN** the user resolves a conflict with a set of decisions
- **THEN** the chosen tasks (and their tags) are merged into the document and the conflict file is deleted

### Requirement: Version gate

The system SHALL refuse to load a data or conflict file written by a newer schema
version, surfacing an "update the app" condition instead of dropping unknown fields.

#### Scenario: Newer file is rejected, not downgraded
- **WHEN** a replica or conflict file declares a version higher than the running build supports
- **THEN** it is rejected rather than parsed and rewritten with fields stripped

### Requirement: Relocatable data folder

The system SHALL let the user point the data folder at a chosen directory (or clear
back to the default app-data dir), repointing the store, restarting the watcher,
and extending the attachment asset scope to the new folder. When seeding an empty
target, the device's history sidecar SHALL be copied beside the new data file so
History stays continuous.

#### Scenario: Choosing a non-folder is rejected
- **WHEN** `set_data_folder` is given a path that is not a directory
- **THEN** it fails with an invalid-input error and the location is unchanged

#### Scenario: Seeding an empty folder keeps history
- **WHEN** the user points at an empty folder that has no task replicas
- **THEN** the current document is seeded there and `history_<device>.jsonl` (or
  legacy `history.jsonl`) is copied beside it

#### Scenario: Adopting an existing folder keeps that folder's history
- **WHEN** the chosen folder already holds task data
- **THEN** that folder's document is adopted and this device's previous history
  sidecar is not copied over it
