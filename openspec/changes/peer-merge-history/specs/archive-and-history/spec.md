## ADDED Requirements

### Requirement: Peer merge appends history with dedup

The system SHALL, when a peer-replica reload merges a Document that differs from the
pre-merge Document, append the derived entity change events to this device's
`history_<device>.jsonl`. The system SHALL NOT append duplicate merge-derived entries
for the same logical change when the same peer state is reloaded again (stable dedup).

#### Scenario: Peer merge produces history once
- **WHEN** a peer replica introduces a new or updated entity and this device reloads
  replicas
- **THEN** a corresponding history entry is appended to this device's history sidecar

#### Scenario: Second reload with same peers does not duplicate
- **WHEN** peer replicas are unchanged (or merge to the same Document) and reload runs
  again
- **THEN** no additional duplicate history lines are appended for the already-recorded
  merge changes

### Requirement: History entries carry device identity

The system SHALL include optional `device_id` and `device_name` on history entries.
New entries from local writes and from peer-merge appends SHALL be stamped with this
device's id and a readable name (prefer OS hostname; fall back to a sanitized device
id). Legacy history lines without these fields SHALL still load.

#### Scenario: Device fields round-trip
- **WHEN** a history entry is written with `device_id` and `device_name`
- **THEN** reading history returns those fields unchanged

#### Scenario: Legacy lines without device still load
- **WHEN** a history JSONL line omits `device_id` and `device_name`
- **THEN** the entry still deserializes and appears in the History view

### Requirement: History view shows device name

The History view SHALL display a readable device name when present on an entry
(falling back to device id when only that is present).

#### Scenario: Named device appears in the list
- **WHEN** an entry has `device_name` set
- **THEN** the History row shows that name

### Requirement: History remains a JSONL sidecar

The system SHALL keep history in per-device `history_<device>.jsonl` sidecars and SHALL
NOT store the history log inside the SQLite Document database as part of this change.

#### Scenario: History file stays beside the replica
- **WHEN** history is appended
- **THEN** it is written to `history_<device>.jsonl` beside the data replica, not into
  the Document DB tables

## MODIFIED Requirements

### Requirement: History sidecar

The system SHALL append entity change events (timestamp, event, entity, id, title,
summary, and optional device identity) to a per-device history sidecar file, derived
from document diffs for local writes and for peer-merge reloads that change the
Document.

#### Scenario: Edits produce history entries
- **WHEN** a task/tag/template is created, updated, or deleted
- **THEN** a corresponding entry is appended to `history_<device>.jsonl`

#### Scenario: History is per-device
- **WHEN** the data file is `tasks_<device>.db` (or legacy `.json`)
- **THEN** its history is written to `history_<device>.jsonl` beside it

#### Scenario: Peer-visible changes produce history entries
- **WHEN** a peer merge changes the live Document
- **THEN** corresponding entries are appended to this device's history sidecar without
  duplicating on subsequent identical reloads
