## Why

The Today view is pinned to whatever logical day was current when the indexes were
last built, and nothing re-derives it from the clock. An app left open across the
day-start hour keeps showing the previous day's list — wrong date in the header,
yesterday's completions still lingering, today's tasks missing — until an unrelated
mutation or a restart happens to rebuild the indexes (#148). A task tracker whose
"today" silently goes stale overnight is wrong exactly when a user opens it in the
morning.

## What Changes

- The logical day becomes a clock-driven value that advances on its own: when wall-clock
  time crosses the configured `day_start_hour` boundary, the derived views recompute
  without any user action or document mutation.
- The rollover is observed for the whole app from one place, so every consumer of
  "today" (Today membership and its date header, overdue split, recurrence ghosts,
  the Composer's default `start_date`, Upcoming, Archived) advances together rather
  than drifting apart.
- A rollover triggered while the app is asleep/suspended is picked up on resume, not
  only on the next scheduled tick — a laptop closed at 23:00 and opened at 09:00 must
  show the new day immediately.
- No new Settings controls, no model or persistence changes, no change to *how*
  `day_start_hour` is interpreted — only to *when* it is re-read.

## Capabilities

### New Capabilities

None. This corrects the behavior of an existing capability.

### Modified Capabilities

- `task-views`: the "Configurable day rollover" requirement currently constrains only
  how a given wall-clock time maps to a logical day. It gains the liveness half of that
  contract — the app SHALL follow the boundary as time passes, including across sleep —
  so a stale Today view is a spec violation rather than an unspecified gap.

## Impact

- `src/state/store.ts` — `useDocument`'s `indexes` memo depends on `doc` alone; it needs
  a clock input.
- `src/state/indexes.ts` — `buildIndexes` reads `new Date()` internally (line 252), which
  makes the current logical day an untestable hidden input; it should be supplied.
- `src/views/TodayView.tsx`, `UpcomingView.tsx`, `ArchivedView.tsx` and the recurrence
  ghost projection consume `indexes.todayIso` and inherit the fix without local changes.
- Tests: `src/state/store.test.ts` (rollover, already written and failing),
  `src/state/indexes.test.ts` (explicit day injection).
- No Rust, model, schema, or locale changes. No persisted data is touched.
