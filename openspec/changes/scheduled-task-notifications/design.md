## Context

Tasks store `start_date`/`start_time` and `due_date`/`due_time` as `YYYY-MM-DD` plus optional `HH:MM` local. The UI renamed "scheduled" to **start**; Today/Upcoming treat start as when work begins and due as a deadline. `TimeEstimateReminder` polls every second and sends immediate OS notifications — it does not survive sleep or app closure.

`@tauri-apps/plugin-notification` supports `Schedule.at(date, repeating, allowWhileIdle)` and listing/cancelling pending notifications.

## Goals / Non-Goals

**Goals:**

- Notify once when an active task's arrival moment passes.
- Prefer start over due; all-day uses `day_start_hour`.
- Skip completed/archived tasks.
- Dedupe across ticks and app restarts (device-local storage).
- Best-effort OS scheduling for near-future arrivals; catch-up on resume.

**Non-Goals:**

- New Settings toggle (permission is requested on first send, same as estimate reminders).
- Notifying for recurring template ghosts (only real tasks).
- True background wake on desktop when the app process is not running.
- Re-notifying every day for open-ended spans (one shot at the arrival instant).

## Decisions

### 1. Start over due

- **Choice:** Arrival kind is `start` when `start_date` is set, else `due` when only `due_date` is set.
- **Why:** Matches editor/list language ("Start" field) and when the user expects to begin work.

### 2. All-day at day-start hour

- **Choice:** Missing time uses `day_start_hour:00` local on that date.
- **Why:** Consistent with logical-day rollover used by Today and analytics.

### 3. Hybrid scheduler

- **Choice:** `ScheduledTaskNotifier` runs one serialized tick chain (interval, focus, visibility) so overlapping checks cannot double-send. Due arrivals are claimed synchronously before any await; delivery runs before OS sync cancels stale pending entries. Delivery reconciliation only marks arrivals when `active()` / `onNotificationReceived` provide explicit evidence — not when pending disappears. Registered OS ids are persisted and cancelled when no longer desired or eligible, including orphans from completed/deleted/kind-changed tasks.
- **Why:** Polling alone misses sleep; OS schedule alone misses edits and may not persist when the process exits on desktop.
- **Missed grace:** Notify on resume only if arrival was within the last hour (avoids spamming old tasks on first run).

### 4. Dedupe keys in localStorage

- **Choice:** Key `pansuthong.scheduledArrivalNotified` stores delivered arrival keys; `pansuthong.scheduledArrivalOsRegistered` maps arrival keys to OS notification ids for orphan cancel on completion/deletion/kind change.
- **Why:** Device-local, no schema change; survives restart and cancels registrations the current eligible set no longer owns.

### 5. Stable notification IDs

- **Choice:** 32-bit id from hashing `kind` + task id (required by the plugin for cancel/reschedule).
- **Why:** Lets us replace pending OS notifications when tasks change.

## Risks / Trade-offs

- **[Risk] Desktop app closed** → OS schedule may not fire; documented limitation.
- **[Risk] Permission denied** → silent no-op (same as estimate reminders).
- **[Risk] Clock / DST** → use local `Date` construction from date+time fields (same as rest of app).

## Migration Plan

- Ship in next build. No data migration. Clearing site data clears dedupe history.
