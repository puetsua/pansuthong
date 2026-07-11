## MODIFIED Requirements

### Requirement: Per-device replicas

The system SHALL write only this device's replica, named from its stable
`device_id` as a SQLite database (`tasks_<device>.db`), publishing it as a
checkpointed single-file snapshot, and never modify another device's replica file.

#### Scenario: Each device owns its file
- **WHEN** two devices sync into the same folder
- **THEN** each writes only its own `tasks_<device>.db` snapshot and reads the others read-only

#### Scenario: Peer replicas are read defensively
- **WHEN** a peer `tasks_<device>.db` fails an integrity check (e.g. read mid-sync)
- **THEN** that replica is skipped for this pass and retried on the next watcher/poll tick,
  rather than aborting the merge

### Requirement: Entity-level merge

The system SHALL compute the visible document by merging all replicas with
last-write-wins per entity (task/tag/template) keyed by its edit stamp, applying
tombstones so a deleted entity is not resurrected by a stale replica. Each replica is
decoded from its SQLite database into a `Document`; the merge algorithm is unchanged.

#### Scenario: Newer edit wins
- **WHEN** two replicas carry different versions of the same task
- **THEN** the one with the greater edit stamp wins the fields (time entries and attachments still union)

#### Scenario: Tombstone suppresses a stale entity
- **WHEN** one replica deleted an entity (tombstone) and another still has an older copy
- **THEN** the merged document omits it
