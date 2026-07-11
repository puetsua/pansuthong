# archive-and-history Specification

## Purpose

Completed tasks are archived (the same `completed_at` state that removes them from
active views) and browsable in the Archived view. Separately, a per-device
append-only history sidecar (`history_<device>.jsonl`) records created/updated/
deleted events derived by diffing **local** document writes, surfaced in the
History view. Peer replica merges update the live document but do not append
history on this device — History is a federated audit of what each device wrote,
not a log of the merged world. Both views share date-range filtering and paging
controls.

## Requirements

### Requirement: Archived view

The system SHALL list completed tasks in the Archived view, ordered by completion,
excluding active tasks.

#### Scenario: Only completed tasks appear
- **WHEN** the Archived view is shown
- **THEN** it lists tasks whose `completed_at` is set and no active tasks

### Requirement: History sidecar

The system SHALL append entity change events (timestamp, event, entity, id, title,
summary) to a per-device history sidecar file, derived from document diffs.

#### Scenario: Edits produce history entries
- **WHEN** a task/tag/template is created, updated, or deleted
- **THEN** a corresponding entry is appended to `history_<device>.jsonl`

#### Scenario: History is per-device
- **WHEN** the data file is `tasks_<device>.db`
- **THEN** its history is written to `history_<device>.jsonl` beside it

#### Scenario: Peer merge does not append local history
- **WHEN** a peer replica change is merged via reload/poll
- **THEN** this device's `history_<device>.jsonl` is not appended for that merge
  (peer devices keep their own history sidecars; the History view concatenates
  all `history_*.jsonl` at read time)

### Requirement: Shared list filters and paging

The system SHALL provide shared date-range filters and page-size paging used by
both the Archived and History views.

#### Scenario: Date-range filter narrows results
- **WHEN** a date range is applied
- **THEN** both views show only items within the range, paged by the selected page size
