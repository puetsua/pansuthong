# android-folder-sync Specification

## Purpose

On Android there is no always-mounted cloud folder, so an app-private local
master (`tasks_<device>.db`) remains crash-safe and a mirror layer copies it
(and conflict copies, attachment blobs, and `history_<device>.jsonl` sidecars)
to and from a user-picked SAF (Storage Access Framework) folder. All SAF I/O
sits behind a `SafBackend` trait so the mirror logic is testable on desktop;
the SAF commands are no-ops on non-Android targets.

## Requirements

### Requirement: Pick and clear the SAF folder

The system SHALL let the user pick a SAF folder to mirror into, and clear it,
reporting sync status.

#### Scenario: Non-Android is a no-op
- **WHEN** a SAF command runs on desktop
- **THEN** it returns a neutral status without touching any folder

### Requirement: Bidirectional mirror

The system SHALL push the local master to the SAF folder as this device's
`tasks_<device>.db` snapshot and pull remote `.db` replicas (and legacy
`tasks_*.json` peers) back, merging them through the same document merge used
elsewhere, and SHALL never write WAL/`-shm` sidecar files into the SAF folder.

#### Scenario: Pull merges remote replicas
- **WHEN** `saf_sync_now` runs and the SAF folder holds `.db` replicas from other devices
- **THEN** they are read and merged into the local document

#### Scenario: Pull still merges legacy JSON peers
- **WHEN** the SAF folder holds a `tasks_<peer>.json` replica and no `.db` for that peer
- **THEN** the JSON replica is included in the same entity-level merge

#### Scenario: Push mirrors the master snapshot out
- **WHEN** `saf_push` runs
- **THEN** the local master's `.db` bytes (and recognized conflict copies) are written to
  the SAF folder, and no WAL sidecar files are written there

### Requirement: History sidecar mirroring

The system SHALL mirror this device's `history_<device>.jsonl` into the SAF folder
on push, and SHALL pull peer `history_*.jsonl` sidecars into the app-private folder
on pull. Push SHALL NOT write peer history files. Pull SHALL NOT overwrite a local
own sidecar that already exists (local appends remain the source of truth until the
next push). An explicit folder-switch SHALL adopt the folder's own sidecar when
present and SHALL remove a local own sidecar the folder does not contain. Bare
`history.jsonl` SHALL NOT be mirrored.

#### Scenario: Push writes own history sidecar
- **WHEN** `saf_push` runs and the app-private folder holds `history_<device>.jsonl`
- **THEN** that file is written to the SAF folder beside the `.db` replica

#### Scenario: Push still writes history when the document is unchanged
- **WHEN** `saf_push` runs and the document content hash matches the last synced hash
- **THEN** an updated own history sidecar is still written if its bytes differ

#### Scenario: Pull copies peer history sidecars
- **WHEN** the SAF folder holds `history_<peer>.jsonl`
- **THEN** a pull copies it into the app-private data folder

#### Scenario: Pull does not clobber local own history
- **WHEN** the app-private folder already has `history_<device>.jsonl`
- **THEN** a pull leaves that file unchanged even if the SAF folder has a different copy

#### Scenario: Switch adopts the folder's own history
- **WHEN** the user links a folder that already has `history_<device>.jsonl`
- **THEN** that sidecar replaces the local own file (the discarded document is not the source of truth)

#### Scenario: Switch drops own history absent from the folder
- **WHEN** the user links a folder that has no `history_<device>.jsonl`
- **THEN** the local own sidecar is removed so the next push does not publish history from the discarded document

### Requirement: Attachment and conflict mirroring

The system SHALL mirror managed attachment files — both legacy flat `attachment_*`
and files under `attachments_<device>/` — and conflict copies alongside the data
file, validating attachment names with the same guard used on desktop.

#### Scenario: Per-device attachment subdirectory is mirrored
- **WHEN** the local data folder holds `attachments_<device>/attachment_*` blobs
- **THEN** a SAF push writes those files into the matching subdirectory in the SAF folder

#### Scenario: Remote attachment subdirectory is pulled
- **WHEN** the SAF folder holds `attachments_<peer>/attachment_*` files
- **THEN** a pull copies them into the app-private data folder under the same relative paths

#### Scenario: Resolved conflict is removed from the SAF folder
- **WHEN** a conflict is resolved or dismissed on Android
- **THEN** the corresponding conflict copy is also removed from the SAF folder so it does not reappear on the next pull
