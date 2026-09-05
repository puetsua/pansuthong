## ADDED Requirements

### Requirement: Calendar view

The system SHALL provide a Calendar view at `/calendar` that shows open (non-done,
non-archived) tasks on their `start_date` and/or `due_date`, plus recurring template
ghosts from the same projection used by Today and Upcoming. The view is a computed
query — never a persisted list. Completed and archived tasks SHALL NOT appear.

The view SHALL render a month grid with day numbers, per-day item count badges, solid
markers for real tasks, and dashed/hollow markers for recurring ghosts. Selecting a
day SHALL show that day's agenda below the grid, reusing the standard task row and tag
pill components. Layout SHALL stack grid and agenda on narrow screens (no separate side
panel). The header SHALL offer previous month, next month, and jump-to-today controls.

#### Scenario: Task on start date appears
- **WHEN** an open task has `start_date` on a visible day
- **THEN** that day shows a marker and the task appears in that day's agenda when selected

#### Scenario: Task on due date appears
- **WHEN** an open task has `due_date` on a visible day and no `start_date` on that day
- **THEN** that day shows a marker and the task appears in that day's agenda when selected

#### Scenario: Recurring ghost appears
- **WHEN** a recurring template projects a ghost on a day and no real task suppresses it
- **THEN** that day shows a ghost marker and the ghost appears in the agenda when selected

#### Scenario: Completed tasks excluded
- **WHEN** a task is completed
- **THEN** it does not appear on the calendar grid or in the agenda

### Requirement: Calendar in primary navigation

The system SHALL place a Calendar entry in the primary sidebar navigation immediately
below Upcoming and above Search. On mobile, Calendar SHALL appear as a bottom-tab
primary destination; Upcoming SHALL remain reachable from the More menu.

#### Scenario: Desktop nav order
- **WHEN** the sidebar primary nav is rendered
- **THEN** the order is Today, Inbox, Upcoming, Calendar, then Search, before Tags

#### Scenario: Mobile bottom tab
- **WHEN** the mobile bottom tabs are rendered
- **THEN** Calendar is a primary tab linking to `/calendar`
