## 1. Make the logical day an explicit input

- [x] 1.1 Add an optional `todayIso` parameter to `buildIndexes` in `src/state/indexes.ts`, defaulting to the existing `computeTodayIso(new Date(), dsh)` so current callers are unchanged
- [x] 1.2 Add a test in `src/state/indexes.test.ts` that pins the logical day via the new parameter and asserts Today membership follows it without faking global time

## 2. Drive the boundary from the clock

- [x] 2.1 Create `src/lib/useLogicalDay.ts` exporting `useLogicalDay(dayStartHour: number): string`, returning the current logical day ISO
- [x] 2.2 Recompute on a 60s interval and update state only when the derived string changes, so a non-crossing tick causes no re-render
- [x] 2.3 Recompute on `visibilitychange` when the document becomes visible, so a boundary crossed during sleep is picked up on resume
- [x] 2.4 Clean up both the interval and the listener on unmount, and re-arm when `dayStartHour` changes

## 3. Wire it into the store

- [x] 3.1 In `src/state/store.ts`, derive `dayStartHour(doc.settings)` (falling back to `DAY_START_HOUR_DEFAULT` while `doc` is null) and call `useLogicalDay`
- [x] 3.2 Pass the hook's value into `buildIndexes` and add it to the `useMemo` dependency list
- [x] 3.3 Confirm no view changes are needed — `TodayView`, `UpcomingView`, `ArchivedView`, ghosts and `Composer` all read `indexes.todayIso`

## 4. Verify

- [x] 4.1 Make the two failing rollover tests in `src/state/store.test.ts` pass (day-start hour 4, and plain midnight)
- [x] 4.2 Add a `store.test.ts` case for resume: cross the boundary with timers suspended and fire `visibilitychange`, asserting the day advances without waiting for a tick
- [x] 4.3 Add a `store.test.ts` case asserting a tick that does not cross a boundary keeps the same `indexes` reference (no needless rebuild)
- [x] 4.4 Run `npm test`, `npm run lint`, and `npm run build` clean
