# task-management Specification

## Purpose

Create, edit, complete, duplicate, and delete tasks — the product's central unit of
work. A task carries a title, optional start/due dates each with an optional
wall-clock time, notes, tag references, an optional effort estimate, and
completion state. Completion state (`completed_at`) is the single source of truth
for both "done" and "archived".

## Requirements

### Requirement: Task creation

The system SHALL create a task from a non-empty title and optional fields, assign
it a stable prefixed id, and stamp `created_at`/`updated_at`.

#### Scenario: Title is required
- **WHEN** `add_task` is called with a title that is empty or whitespace-only
- **THEN** the call fails with an invalid-input error and no task is created

#### Scenario: Unknown tag references are dropped
- **WHEN** a task is created with `tag_ids` that include ids not present in the document
- **THEN** the unknown ids are removed before persisting, so a task never stores a dangling tag reference

#### Scenario: A time without its date is discarded
- **WHEN** a task is created with a `due_time` but no `due_date` (or `start_time` without `start_date`)
- **THEN** the orphaned time is dropped and the task is stored as all-day

### Requirement: Task editing

The system SHALL apply partial updates to a task, validating changed fields, while
distinguishing an absent field (leave unchanged) from an explicit null (clear it).

#### Scenario: Clearing a date clears its time
- **WHEN** `update_task` sets `due_date` to null
- **THEN** `due_time` is also cleared, because a time without its date is meaningless

#### Scenario: Invalid values are rejected without partial mutation
- **WHEN** an update supplies an out-of-range estimate or a non-`HH:MM` time
- **THEN** the update fails and the task is left unchanged

#### Scenario: Title cannot be blanked
- **WHEN** an update sets the title to whitespace-only
- **THEN** the update fails with an invalid-input error

### Requirement: Effort estimate

The system SHALL accept an optional whole-second effort estimate bounded to a
positive range, and omit the field entirely when absent.

#### Scenario: Estimate out of range
- **WHEN** an estimate below 1 second or above the maximum (100000 minutes) is supplied
- **THEN** the call fails with an invalid-input error

#### Scenario: Legacy minute estimates load
- **WHEN** a task file carries the legacy `estimated_minutes` key
- **THEN** it loads as `estimated_seconds` multiplied by 60

### Requirement: Completion and archival are one state

The system SHALL treat `completed_at` as the sole encoding of done and archived:
completing a task sets it (sweeping the task out of active views) and reopening
clears it.

#### Scenario: Completing a task archives it and stops its timer
- **WHEN** a task is marked done
- **THEN** `completed_at` is set, the task leaves the active views, and any running timer is closed

#### Scenario: Reopening restores the task
- **WHEN** a completed task is marked not-done
- **THEN** `completed_at` is cleared and the task returns to the active views

### Requirement: Task duplication

The system SHALL duplicate a task as a fresh active task with a new id, a
"(copy)" title suffix, its own copied attachment blobs, and no completion or time
entries.

#### Scenario: Duplicated attachments are independent
- **WHEN** a task with attachments is duplicated
- **THEN** each attachment blob is copied to a new file with a new id and note references are rewritten to the copies

### Requirement: Task deletion

The system SHALL remove a task, record a delete tombstone so stale replicas cannot
resurrect it, and garbage-collect attachment blobs no longer referenced.

#### Scenario: Deleting a task tombstones it
- **WHEN** `delete_task` succeeds
- **THEN** a tombstone with the deletion timestamp is added and orphaned attachment files are removed

#### Scenario: Deleting a missing task errors
- **WHEN** `delete_task` is called with an id that does not exist
- **THEN** the call fails with a not-found error

### Requirement: Backward-compatible task loading

The system SHALL load task files written by older builds without data loss,
folding legacy keys into the current shape.

#### Scenario: Legacy done/archived keys fold into completed_at
- **WHEN** a task file carries `done`/`archived`/`archived_at` but no `completed_at`
- **THEN** the task loads as completed, using `archived_at` (or epoch 0 as a "time unknown" sentinel)

#### Scenario: Legacy scheduled keys map to start fields
- **WHEN** a task file carries `scheduled_date`/`scheduled_time`
- **THEN** they load into `start_date`/`start_time` and re-serialize under the new names
