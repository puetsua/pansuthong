## Context

Today membership is computed in `buildIndexes` (`src/state/indexes.ts`) by `inToday`,
which delegates to `coversToday` (start ≤ today, or due today/overdue). Time tracking
stores `time_entries` on each task; each entry has `start` and optional `end` as local
ISO-8601 strings with offset (`2026-06-01T20:34:56+08:00`), and an open entry (`end`
absent) means a running timer. The app already has `logicalDayOf(iso, dayStartHour)`
that maps such a string to its logical `YYYY-MM-DD`, honoring the day-start hour — the
same helper used to attribute completions to a logical day.

## Goals / Non-Goals

**Goals:**
- Surface an active task in Today while its timer runs, independent of dates.
- Keep an active task in Today after the timer stops if it was tracked during today's
  logical day, dropping out at rollover.

**Non-Goals:**
- No change to completed/archived membership, sorting, or any other view.
- No new persisted state — reuse existing `time_entries` and `logicalDayOf`.

## Decisions

**Add a `trackedToday` predicate and OR it into the open-task branch of `inToday`,
not the top level.** A task is tracked-today if it has a running entry (`end == null`)
or any entry whose start or end maps to `todayIso` via `logicalDayOf`. Keeping it in
the `!isDone` branch means completed/archived tasks are wholly unaffected, so the
existing "completed tasks excluded / completed-today lingering" behavior and its tests
are untouched. Rationale: a running timer implies the task is open (you don't track a
completed task); completion is a separate deliberate action the goal does not ask to
override. Alternative considered — applying `trackedToday` above the done check —
rejected because it could re-surface an archived task that merely carries a today-dated
entry, widening scope beyond the request.

**Check both `start` and `end` against today.** Covers a session started before today
that ends today (overnight timer stopped this morning) as well as the common
started-and-stopped-today case; a running entry short-circuits regardless.

## Risks / Trade-offs

- [An undated task completed today after tracking would still vanish from Today, since
  the done branch is unchanged] → Accepted: matches existing behavior for undated
  completions and the goal is about *stopping* a timer, not completing the task.
- [Malformed/edited timestamps] → `logicalDayOf` slices the ISO string; a non-today or
  unparon-slice value simply won't match today, so a bad entry can't force-include a
  task. Running detection keys only on `end == null`.

## Migration Plan

Single commit on `main`. Pure additive query logic; no data migration. Rollback is a
plain revert. Verify with `tsc`, the `indexes` unit tests, and the app.
