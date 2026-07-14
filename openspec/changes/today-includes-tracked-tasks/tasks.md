## 1. Implement Today tracking inclusion

- [x] 1.1 In `src/state/indexes.ts`, add a `trackedToday(t, todayIso)` predicate inside `buildIndexes` (captures `dsh`): true if any time entry is running (`end == null`) or has `start`/`end` mapping to `todayIso` via `logicalDayOf`
- [x] 1.2 OR `trackedToday` into the open-task (`!isDone`) branch of `inToday`, leaving the done branch unchanged

## 2. Tests

- [x] 2.1 Add `indexes.test.ts` coverage: an undated active task with a running timer appears in Today
- [x] 2.2 Add coverage: an undated active task with a stopped-today entry stays in Today; the same task with only a prior-day entry is absent (rollover); plus an overnight entry ending today; plus a completed prior-day task stays excluded
- [x] 2.3 Add coverage honoring `day_start_hour`: an entry just after midnight attributes to the prior logical day (mirrors the completed-linger #109 case)

## 3. Verify

- [x] 3.1 `npx tsc --noEmit` clean; `indexes.test.ts` 38/38 and full suite 575/575 pass
- [x] 3.2 Launched the desktop dev app — it built and rendered with no runtime errors. Live GUI assertion was blocked: the Tauri MCP webview-injection path (execute_js/screenshot) times out at 2s in this environment and the IPC bridge only exposes a restricted command set. The behavior is the membership function `inToday`, exercised directly by the 5 new unit tests; TodayView renders `indexes.today()` unmodified, and the live backend confirmed the app runs cleanly. Timestamp format assumption verified at source (`iso_secs` → local ISO with offset)
- [x] 3.3 `openspec validate today-includes-tracked-tasks --strict` passes
