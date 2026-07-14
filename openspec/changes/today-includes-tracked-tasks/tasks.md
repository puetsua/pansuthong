## 1. Implement Today tracking inclusion

- [ ] 1.1 In `src/state/indexes.ts`, add a `trackedToday(t, todayIso)` predicate inside `buildIndexes` (captures `dsh`): true if any time entry is running (`end == null`) or has `start`/`end` mapping to `todayIso` via `logicalDayOf`
- [ ] 1.2 OR `trackedToday` into the open-task (`!isDone`) branch of `inToday`, leaving the done branch unchanged

## 2. Tests

- [ ] 2.1 Add `indexes.test.ts` coverage: an undated active task with a running timer appears in Today
- [ ] 2.2 Add coverage: an undated active task with a stopped-today entry stays in Today; the same task with only a prior-day entry is absent (rollover)
- [ ] 2.3 Add coverage honoring `day_start_hour`: an entry just after midnight attributes to the prior logical day (mirrors the completed-linger #109 case)

## 3. Verify

- [ ] 3.1 `npx tsc --noEmit` and `npx vitest run src/state/indexes.test.ts` pass, then the full `npx vitest run`
- [ ] 3.2 Run the desktop dev app: start a timer on a date-less task and confirm it appears in Today; stop it and confirm it stays
- [ ] 3.3 `openspec validate today-includes-tracked-tasks --strict` passes
