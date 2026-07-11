## MODIFIED Requirements

### Requirement: History sidecar

The system SHALL append created/updated/deleted events (with a human-readable
summary) to a per-device history sidecar file, derived from document diffs.
Append SHALL be crash-safe: a failure mid-append MUST NOT corrupt previously
durable entries (at worst the in-flight entries are lost).

#### Scenario: Local write appends history
- **WHEN** a local document write creates, updates, or deletes an entity
- **THEN** a corresponding entry is appended to `history_<device>.jsonl`

#### Scenario: History is per-device
- **WHEN** the data file is `tasks_<device>.db`
- **THEN** its history is written to `history_<device>.jsonl` beside it

#### Scenario: Crash mid-append preserves prior entries
- **WHEN** the process is interrupted while appending history
- **THEN** previously flushed entries remain readable (torn in-flight data is not
  left as the sole durable content of the sidecar)
