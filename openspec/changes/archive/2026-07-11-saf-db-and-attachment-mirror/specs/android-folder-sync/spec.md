## MODIFIED Requirements

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
