# Time tracking — design (issue #81)

Start/stop timers to record time spent per task, with manual entry editing.

## Decisions (locked with the user)

- **Scope:** MVP **plus** manual add/edit/delete of time entries. No reports view (a follow-up).
- **Storage:** a list of `{start, end}` intervals on the task; the open interval (no `end`) is the running timer. Preserves session history and is extensible.
- **Concurrency:** multiple **different** tasks may run timers at once; a single task has at most one open interval.
- **Controls:** compact start/stop + elapsed on each task row, and a full "Time tracked" section in the task editor.

## Data model (`src-tauri/src/model.rs`)

```rust
struct TimeEntry {
    id: String,
    start: i64,          // iso_secs  (epoch ms in memory, ISO-8601 on disk)
    end: Option<i64>,    // iso_secs_opt; None = running
}
// Task gains:
#[serde(default, skip_serializing_if = "Vec::is_empty")]
time_entries: Vec<TimeEntry>,
```

- Additive and backward-compatible: routed through `TaskCompat` (defaults to empty), and tasks with no entries serialize byte-for-byte as before.
- **Schema version 5 → 6.** A v5 build silently drops unknown fields on its next write, which would lose time entries; bumping makes a stale build reject the file ("update the app") instead — the same protection already applied when templates moved out (v4 → v5). Trade-off: every synced device must update.
- `schemas/tasks.schema.json`: add a `timeEntry` `$def` and a `time_entries` array property on `task`.

## Backend commands (`src-tauri/src/commands.rs`, registered in `lib.rs`)

Each persists, emits `store-changed`, and returns the updated `Task`:

- `start_timer(task_id)` — append an open entry; no-op if the task already has one open.
- `stop_timer(task_id)` — set `end = now` on the open entry; no-op if none open.
- `add_time_entry(task_id, start, end)` — manual; requires `end > start`.
- `update_time_entry(task_id, entry_id, start?, end?)` — manual edit; validates the resulting `end > start`.
- `delete_time_entry(task_id, entry_id)`.
- `set_task_done(id, true)` also auto-stops a running timer on that task.

Validation errors use the existing `AppError::Invalid`.

## Frontend

- `src/lib/tauri.ts`: `TimeEntry` type, `Task.time_entries?`, and the five `api.*` wrappers.
- `src/lib/time.ts` (pure, unit-tested): `runningEntry`, `isTiming`, `elapsedMs(task, now)` (sum of closed `end-start` + open `now-start`, clamped ≥ 0), `formatClock(ms)` (`0:07` / `1:23:45`, live ticker), `formatDurationShort(ms)` (`1h 23m` / `5m`, totals).
- `src/lib/useNow.ts`: `useNow(active)` returns current ms, re-rendering every 1s **only while active** (a running timer); no idle interval.
- `src/components/TaskRow.tsx`: a compact button before the checkbox — ▶ start (with total when any), or a live `0:07` with ■ stop while running; row tagged `data-timing`.
- `src/components/TaskEditor.tsx`: a "Time tracked" section — total, Start/Stop, a list of entries (start, end/"running", duration, edit + delete), and "Add entry" with `datetime-local` inputs.
- `src/styles/global.css`: styles for the row control and editor list.

## Edge cases

- Open interval with `now < start` (clock skew / manual) → elapsed clamped to ≥ 0.
- A task should never hold two open intervals (start guards), but `elapsedMs` sums all open ones defensively.
- Completing a task stops its running timer; reopening does not restart it.
- Deleting the open entry stops timing.
- Cross-device: the open interval syncs; stopping on any device closes it (existing last-writer-wins conflict handling). Acceptable.

## Testing

- **Rust:** `TimeEntry` round-trip (open + closed), back-compat load of a file without `time_entries`, each command (incl. validation failures), auto-stop on complete, and a version-bump guard.
- **Frontend:** `time.ts` helpers (open/closed/zero/clamp, both formatters); `TaskRow` start/stop interaction; `TaskEditor` add/edit/delete of entries.
