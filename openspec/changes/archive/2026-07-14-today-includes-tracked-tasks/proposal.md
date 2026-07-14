## Why

When you start a timer on a task, you are working on it *now* — but if that task
has no start or due date it never appears in Today, so the thing you're actively
tracking is invisible in the one view meant to show "what I'm doing today". And once
a timer is stopped, any date-less task you just spent time on would vanish, losing the
at-a-glance record of what you touched today.

## What Changes

- Today view SHALL include an active (not done) task while it has a **running timer**,
  regardless of its start/due dates.
- Today view SHALL keep an active task that was **tracked earlier in today's logical
  day** (any time entry whose start or end falls on today) even after the timer is
  stopped, until the day rolls over.
- No change to completed/archived tasks, to the day-start-hour rollover, or to any
  other view. Purely additive membership for the open-task Today query.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `task-views`: the "Today view" requirement gains a time-tracking inclusion path —
  a running or tracked-today active task appears in Today independent of its dates.

## Impact

- `src/state/indexes.ts`: extend `inToday`'s open-task branch with a `trackedToday`
  check (running entry, or a time entry on today's logical day via `logicalDayOf`).
- `src/state/indexes.test.ts`: add coverage for the running and stopped-today cases,
  and for rollover dropping a tracked task the next day.
- No backend, data-model, or on-disk change; time entries already carry local ISO
  timestamps with offset, so day attribution reuses the existing `logicalDayOf`.
