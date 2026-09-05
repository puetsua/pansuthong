## Why

Upcoming is a horizon list grouped by day; users cannot see how tasks spread across a
month or pick a date at a glance (#172). A Calendar view complements Upcoming with a
compact month grid and a per-day agenda without persisting another task list.

## What Changes

- Add a `/calendar` route with Proposal C UX: month grid (task count badges, solid dots
  for tasks, dashed dots for recurring ghosts), day selection, and an agenda list below
  the grid reusing existing task rows.
- Sidebar: Calendar entry under Upcoming; mobile bottom tab replaces Upcoming (Upcoming
  moves to the More menu).
- Calendar membership: open tasks on `start_date` or `due_date`, plus the same recurring
  ghost projection used by Today/Upcoming; exclude completed/archived tasks.
- No new Settings controls; not Dashboard heatmap semantics.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `task-views`: add Calendar view requirement and nav placement.

## Impact

- `src/lib/calendar.ts`, `src/views/CalendarView.tsx`, routing/shell/i18n/CSS.
- Tests for calendar indexing and view rendering.
- No Rust/model/schema changes.
