# task-views Specification

## Purpose

The active views (Today, Inbox, Upcoming, Search, per-Tag) are computed queries
over the current tasks/tags — never persisted lists. Completed (archived) tasks
never appear in any active view. Ordering follows the device-local sort preference.
## Requirements
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

### Requirement: Search view

The system SHALL provide a Search view that filters active (non-archived) tasks by
**text search**: a case-insensitive substring match against task title, notes, and
the names of tags on the task. The Search view is a computed query — never a
persisted list. An empty (whitespace-only) query SHALL NOT list all active tasks;
the view SHALL show an empty/prompt state until the user enters a non-empty query.
Matching results SHALL follow the device-local `sort_order`. Completed (archived)
tasks SHALL never appear in Search. The view SHALL NOT require date-range or
dedicated tag-filter controls for v1 (single text query only).

#### Scenario: Match on title
- **WHEN** the user enters a non-empty query that appears in an active task's title
- **THEN** that task appears in the Search results

#### Scenario: Match on notes
- **WHEN** the user enters a non-empty query that appears only in an active task's notes
- **THEN** that task appears in the Search results

#### Scenario: Match on tag name
- **WHEN** the user enters a non-empty query that appears only in a tag name on an active task
- **THEN** that task appears in the Search results

#### Scenario: Empty query shows no dump
- **WHEN** the Search query is empty or whitespace-only
- **THEN** the view does not list the full set of active tasks

#### Scenario: Completed tasks excluded
- **WHEN** a task is completed
- **THEN** it never appears in Search results

#### Scenario: Case-insensitive match
- **WHEN** the user searches with different casing than the stored title, notes, or tag name
- **THEN** matching active tasks still appear in the results

### Requirement: Search results are paginated

The system SHALL paginate Search results using the shared list paging controls
(page size and previous/next), matching the History/Archived search pattern, so a
large match set does not render as one unbounded list.

#### Scenario: Large match set is paged
- **WHEN** a text query matches more active tasks than the selected page size
- **THEN** the view shows only the current page of matches and offers controls to
  change page and page size

#### Scenario: Query change resets to first page
- **WHEN** the user changes the Search text query while viewing a later page
- **THEN** the results return to the first page of the new match set

### Requirement: Search in primary sidebar nav

The system SHALL place a Search entry in the primary sidebar navigation immediately
below Upcoming and above the Tags section, linking to the Search view.

#### Scenario: Nav order
- **WHEN** the sidebar primary nav is rendered
- **THEN** the order is Today, Inbox, Upcoming, then Search, before the Tags section

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

