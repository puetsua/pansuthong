## MODIFIED Requirements

### Requirement: Today view

The system SHALL include an active task in Today when it starts today, is due
today, or is overdue and not done.

The system SHALL additionally include an active (not done) task in Today while it has
a **running timer**, and SHALL keep such a task in Today for the remainder of the
logical day after the timer is stopped whenever the task has a time entry recorded
during today's logical day — even when the task has no start or due date. When the
logical day rolls over, a task kept in Today solely by today's tracking SHALL drop out.

#### Scenario: Overdue incomplete tasks stay in Today
- **WHEN** a task's due date is before today and it is not done
- **THEN** it appears in Today

#### Scenario: Completed tasks are excluded
- **WHEN** a task is completed
- **THEN** it never appears in Today (or any active view)

#### Scenario: A running timer surfaces an undated task in Today
- **WHEN** an active task with no start or due date has a running timer
- **THEN** it appears in Today

#### Scenario: A task tracked today stays after the timer stops
- **WHEN** an active task with no start or due date was tracked earlier in today's logical day and its timer is now stopped
- **THEN** it still appears in Today for the rest of that logical day

#### Scenario: Tracking-only membership ends at day rollover
- **WHEN** the only reason a task was in Today was a time entry from a previous logical day
- **THEN** it no longer appears in Today
