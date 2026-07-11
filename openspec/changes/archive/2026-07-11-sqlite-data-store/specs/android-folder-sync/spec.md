## MODIFIED Requirements

### Requirement: Bidirectional mirror

The system SHALL push the local master to the SAF folder as a checkpointed
`tasks_<device>.db` snapshot and pull remote `.db` replicas back, merging them through
the same document merge used elsewhere, and SHALL never mirror the live WAL database or
its `-wal`/`-shm` sidecar files.

#### Scenario: Pull merges remote replicas
- **WHEN** `saf_sync_now` runs and the SAF folder holds `.db` replicas from other devices
- **THEN** they are read and merged into the local document

#### Scenario: Push mirrors the master snapshot out
- **WHEN** `saf_push` runs
- **THEN** the local master's `.db` snapshot (and recognized conflict copies) are written to
  the SAF folder, and no WAL sidecar files are written there
