## ADDED Requirements

### Requirement: One-time legacy history.jsonl migration

The system SHALL, when opening a data store (or before copying this device's history
into a new folder), if a bare `history.jsonl` exists beside the data file, append its
parseable lines into this device's `history_<device>.jsonl` (skipping entries whose
`dedup_key` is already present in the own sidecar), then delete `history.jsonl` after
a successful append. The system SHALL NOT create a new bare `history.jsonl` afterward.
The system SHALL continue to read all peer `history_*.jsonl` sidecars.

#### Scenario: Migrate then delete on open
- **WHEN** the data folder contains `history.jsonl` beside `tasks_<device>.db`
- **THEN** those lines are appended into `history_<device>.jsonl` (respecting dedup)
  and `history.jsonl` is removed

#### Scenario: Peer history sidecars still merge
- **WHEN** `history_other.jsonl` exists beside this device's data file
- **THEN** reading history still includes entries from that peer sidecar

#### Scenario: Bare history.jsonl is not read after migration
- **WHEN** migration has deleted `history.jsonl` (or it never existed)
- **THEN** history reads only `history_*.jsonl` files and do not depend on a bare
  `history.jsonl`

## MODIFIED Requirements

### Requirement: History sidecar

The system SHALL append entity change events (timestamp, event, entity, id, title,
summary, and optional device identity) to a per-device history sidecar file, derived
from document diffs for local writes and for peer-merge reloads that change the
Document.
Append SHALL be crash-safe: a failure mid-append MUST NOT corrupt previously
durable entries (at worst the in-flight entries are lost).
The system SHALL resolve the write path as `history_<device>.jsonl` from the data
file's device id (or a stable device fallback when the data file is not
`tasks_<device>.*`) and SHALL NOT write bare `history.jsonl`.

#### Scenario: Edits produce history entries
- **WHEN** a task/tag/template is created, updated, or deleted
- **THEN** a corresponding entry is appended to `history_<device>.jsonl`

#### Scenario: History is per-device
- **WHEN** the data file is `tasks_<device>.db` (or legacy `.json`)
- **THEN** its history is written to `history_<device>.jsonl` beside it

#### Scenario: Non-device-named data file still uses device history
- **WHEN** history is appended for a data file that is not named `tasks_<device>.*`
- **THEN** entries are written to `history_<device>.jsonl` using a stable device id
  fallback, not bare `history.jsonl`

#### Scenario: Crash mid-append preserves prior entries
- **WHEN** the process is interrupted while appending history
- **THEN** previously flushed entries remain readable

#### Scenario: Peer-visible changes produce history entries
- **WHEN** a peer merge changes the live Document
- **THEN** corresponding entries are appended to this device's history sidecar without
  duplicating on subsequent identical reloads
