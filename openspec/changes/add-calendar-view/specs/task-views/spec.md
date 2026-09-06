## ADDED Requirements

### Requirement: Calendar view

The system SHALL provide a Calendar view at `/calendar` that shows open (non-done,
non-archived) tasks on their `start_date` and/or `due_date`, plus recurring template
ghosts from the same projection used by Today and the former Upcoming view. Undated
tasks SHALL NOT appear. The view is a computed query — never a persisted list.

The view SHALL offer a **Month | Week | Day** mode toggle (default **Month** on
entry; the mode is not persisted). **Month** SHALL render a grid with neutral task
lines in cells (no per-task color bars); ghosts are faded and italic. Overflow in a
cell SHALL use a muted `› N more` link that navigates to **Day** mode. Clicking a
date number SHALL navigate to **Day** mode; clicking a task line SHALL open the task
editor.

**Week** SHALL render seven columns of compact neutral task rows (title plus optional
when/tags metadata) without checkboxes or timers. Clicking a column header or date
SHALL navigate to **Day** mode.

**Day** SHALL render a full-width task list reusing TaskRow/GhostRow styling:
checkboxes allowed, time tracking hidden, no side panel.

On narrow screens, **Week** SHALL use a top day strip plus a list below (not
horizontal-scrolling week columns). **Month** on narrow screens keeps the stacked
month grid.

#### Scenario: Task on start date appears
- **WHEN** an open task has `start_date` on a visible day
- **THEN** that day shows the task and it appears in Day mode for that date

#### Scenario: Task on due date appears
- **WHEN** an open task has `due_date` on a visible day
- **THEN** that day shows the task and it appears in Day mode for that date

#### Scenario: Recurring ghost appears
- **WHEN** a recurring template projects a ghost on a day
- **THEN** the ghost appears faded in month/week cells and in Day mode

#### Scenario: Completed tasks excluded
- **WHEN** a task is completed
- **THEN** it does not appear anywhere in the calendar

### Requirement: Calendar replaces Upcoming in navigation

The system SHALL place Calendar in the primary sidebar navigation where Upcoming
formerly lived (below Inbox, above Search). The `/upcoming` route SHALL redirect to
`/calendar`. On mobile, Calendar SHALL remain a bottom-tab primary destination.

#### Scenario: Desktop nav order
- **WHEN** the sidebar primary nav is rendered
- **THEN** the order is Today, Inbox, Calendar, then Search, before Tags

#### Scenario: Upcoming redirect
- **WHEN** the user navigates to `/upcoming`
- **THEN** they land on `/calendar`
