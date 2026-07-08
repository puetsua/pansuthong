# task-views Specification

## Purpose

The active views (Today, Inbox, Upcoming, per-Tag) are computed queries over the
current tasks/tags — never persisted lists. Completed (archived) tasks never
appear in any active view. Ordering follows the device-local sort preference.

## Requirements

### Requirement: Today view

The system SHALL include an active task in Today when it starts today, is due
today, or is overdue and not done.

#### Scenario: Overdue incomplete tasks stay in Today
- **WHEN** a task's due date is before today and it is not done
- **THEN** it appears in Today

#### Scenario: Completed tasks are excluded
- **WHEN** a task is completed
- **THEN** it never appears in Today (or any active view)

### Requirement: Inbox view

The system SHALL include an active task in Inbox when none of its tags are pinned,
so a task not surfaced by any pinned-tag sidebar view is still reachable.

#### Scenario: Untagged task lands in Inbox
- **WHEN** an active task has no tags, or only unpinned/unknown tags
- **THEN** it appears in Inbox

### Requirement: Tag view

The system SHALL include an active task in a tag's view when it carries that tag.

#### Scenario: Tagged task appears under its tag
- **WHEN** an active task references a given tag id
- **THEN** it appears in that tag's view

### Requirement: Upcoming view

The system SHALL show tasks scheduled within the configured horizon ahead, bounded
by the device-local `upcoming_days` (1..=365).

#### Scenario: Horizon follows settings
- **WHEN** `upcoming_days` is changed
- **THEN** the Upcoming window widens or narrows accordingly

### Requirement: Sort order

The system SHALL order task lists by the device-local `sort_order`: "priority"
(weight descending, then date) or "date".

#### Scenario: Priority sort ranks by derived weight
- **WHEN** `sort_order` is "priority"
- **THEN** tasks are ordered by effective priority descending, breaking ties by date

### Requirement: Configurable day rollover

The system SHALL let the logical "today" boundary roll over at a configured hour
(`day_start_hour`, 0..=23), defaulting to midnight.

#### Scenario: Night-owl rollover
- **WHEN** `day_start_hour` is 4 and the wall-clock time is 02:00
- **THEN** the Today view still treats the date as the previous calendar day
