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

### Requirement: AFK while a timer is running

The system SHALL detect when the user has been away from keyboard and mouse
while at least one timer is running on desktop, using OS last-input idle time.
The AFK span SHALL begin at the last input instant, once idle time has crossed a
fixed threshold (five minutes). Android SHALL NOT prompt. When last-input idle
time is unavailable, the system SHALL NOT prompt.

When the user returns from AFK while a timer is still running, or when they stop
a running timer after a long AFK without having answered a prompt, the system
SHALL show an in-app dialog (not an OS notification and not the untracked-idle
assignment UI) that shows elapsed time since AFK start (updating while the
dialog stays open) and offers Keep or Discard.
The dialog SHALL require an explicit choice.

**Keep** SHALL leave the AFK duration in each running interval. If the dialog was
shown because the user returned, timers SHALL continue. If it was shown because
they hit Stop, that task's timer SHALL then stop at the current time (AFK
included).

**Discard** SHALL apply to every task that had a running interval during the AFK
span: close each open interval at the AFK start, or delete the entry when it
started at or after AFK start (no zero-length interval). After Discard, no open
interval SHALL remain.

#### Scenario: Return from AFK prompts keep or discard
- **WHEN** at least one timer is running
- **AND** OS last-input idle time has exceeded the AFK threshold
- **AND** the user provides input again
- **THEN** an in-app dialog shows the AFK duration with Keep and Discard

#### Scenario: Keep leaves AFK time and continues the timer
- **WHEN** the user returns from AFK while a timer is running
- **AND** they choose Keep
- **THEN** the running interval is unchanged
- **AND** the timer continues

#### Scenario: Discard stops at AFK start
- **WHEN** the user returns from AFK while a timer is running
- **AND** they choose Discard
- **THEN** each running interval ends at the AFK start
- **AND** no open interval remains

#### Scenario: Discard drops an entry that started after AFK began
- **WHEN** a running entry's start is at or after the AFK start
- **AND** the user chooses Discard
- **THEN** that entry is deleted rather than stored with zero length

#### Scenario: Several running timers share one choice
- **WHEN** more than one task is timing during the AFK span
- **AND** the user chooses Keep or Discard
- **THEN** that choice is applied to each of those tasks

#### Scenario: Stop after AFK still prompts
- **WHEN** a timer is running and OS last-input idle time has exceeded the AFK threshold
- **AND** the user hits Stop before answering a keep/discard prompt
- **THEN** the same dialog is shown instead of closing the interval at now
- **AND** Keep then stops that task at now with the AFK span included
- **AND** Discard still closes every running interval at the AFK start

#### Scenario: Android and unavailable idle do not prompt
- **WHEN** the app runs on Android, or last-input idle time cannot be read
- **THEN** no AFK-while-running dialog is shown
- **AND** Start/Stop behave as they do today
