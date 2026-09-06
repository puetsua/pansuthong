## ADDED Requirements

### Requirement: Scheduled arrival notifications

The system SHALL notify the user when an active (non-completed) task's scheduled
arrival moment is reached. The arrival moment SHALL be the task's start date and
time when `start_date` is set; otherwise the due date and time when only
`due_date` is set. When a date is set without a time, the moment SHALL be that
date at the document's configured `day_start_hour` (local). Completed/archived
tasks and templates SHALL NOT generate arrival notifications.

The system SHALL send at most one notification per task per arrival kind and
moment, including across app restarts. The system SHALL request OS notification
permission before sending, matching the time-estimate reminder behavior.

#### Scenario: Start date with time

- **WHEN** an open task has `start_date` and `start_time`
- **AND** the local wall-clock reaches that moment
- **THEN** an OS notification shows the task title

#### Scenario: All-day start uses day-start hour

- **WHEN** an open task has `start_date` without `start_time`
- **AND** `day_start_hour` is 4
- **THEN** the notification fires at 04:00 local on that date

#### Scenario: Due-only task

- **WHEN** an open task has no `start_date` but has `due_date` (and optional `due_time`)
- **THEN** the notification fires at the due moment using the same all-day rule

#### Scenario: Completed tasks are skipped

- **WHEN** a task has `completed_at` set
- **THEN** no arrival notification is sent for that task

#### Scenario: No duplicate notifications

- **WHEN** an arrival moment has already triggered a notification for that task
- **THEN** subsequent polls or app resumes do not send another for the same moment
