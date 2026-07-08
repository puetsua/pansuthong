# time-tracking Specification

## Purpose

Each task carries a list of time-tracking intervals (`time_entries`). The single
open interval (no `end`) is the running timer; a task holds at most one, but
different tasks may run concurrently. Entries are stored on the task, so they
sync. The UI also reminds the user when a running task exceeds its estimate and
can assign untracked idle time to a task.

## Requirements

### Requirement: Start and stop timer

The system SHALL start timing by appending an open interval and stop by closing
it, clamping the end to at least the start so a backwards clock cannot record
negative time.

#### Scenario: Starting an already-running timer is a no-op
- **WHEN** `start_timer` is called on a task that already has an open interval
- **THEN** no second open interval is created

#### Scenario: Stopping clamps a backwards clock
- **WHEN** a timer is stopped at a time earlier than its start
- **THEN** the interval's end is set to the start, not to a smaller value

### Requirement: Manual and edited entries do not overlap

The system SHALL reject adding or editing a closed entry unless `end > start` and
the interval does not overlap another entry; touching at an endpoint is allowed.

#### Scenario: Overlapping entry is rejected
- **WHEN** a new/edited entry's interval overlaps an existing one on the same task
- **THEN** the call fails with an invalid-input error and the task is unchanged

#### Scenario: Back-to-back entries are allowed
- **WHEN** a new entry starts exactly when another ends
- **THEN** the entry is accepted

### Requirement: Completion stops the clock

The system SHALL close any running interval when its task is marked done.

#### Scenario: Finishing a running task closes its interval
- **WHEN** a task with an open interval is completed
- **THEN** the interval's end is set to the completion time

### Requirement: Time entries merge additively across replicas

The system SHALL union time entries by id when merging replicas, so a concurrent
addition on a losing replica is not lost.

#### Scenario: Concurrent additions survive a merge
- **WHEN** two replicas each add a distinct entry to the same task
- **THEN** the merged task contains both entries

### Requirement: Estimate reminder

The system SHALL re-notify at the configured interval while a running task keeps
exceeding its estimate (`reminder_interval_minutes`, bounded 1..=1440).

#### Scenario: Repeated reminders while over estimate
- **WHEN** a running task's tracked time passes its estimate and the interval elapses again
- **THEN** another reminder is shown

### Requirement: Idle time assignment

The system SHALL let the user assign untracked idle time (measured from a
session-local, non-synced idle anchor) to a task as a finished entry.

#### Scenario: Assigned idle becomes a time entry
- **WHEN** the user assigns an idle span to a task
- **THEN** a finished entry covering that span is added, subject to the overlap rule
