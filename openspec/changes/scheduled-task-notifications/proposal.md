## Why

Tasks can carry a start or due date with an optional wall-clock time (#10), but Pansuthong never alerts the user when that moment arrives. Time-estimate reminders only fire while the app is running and only for over-budget timers — they are not a model for schedule arrivals.

## What Changes

- OS notifications when an active task's scheduled arrival moment is reached.
- **Start wins over due:** when `start_date` is set, notify at start; otherwise notify at due when only `due_date` is set.
- **All-day:** date without a time fires at the document's `day_start_hour` on that date (same boundary as Today/Upcoming).
- Exclude completed/archived tasks and templates (same as active views).
- Deduplicate per task + kind + moment; persist notified keys across app restarts.
- Request notification permission like `TimeEstimateReminder`.
- Hybrid delivery: poll while the app is running, schedule OS notifications for upcoming arrivals within a horizon (`Schedule.at` with `allowWhileIdle` on Android), and re-check on resume/focus after sleep.
- Locales: en + zh-TW.

## Capabilities

### New Capabilities

- (none)

### Modified Capabilities

- `task-management`: scheduled arrival notifications for active tasks.

## Impact

- Frontend: `src/lib/scheduledNotifications.ts`, `ScheduledTaskNotifier` component, mount in `App`, locales.
- Reuses `@tauri-apps/plugin-notification` (`notification:default` capability).
- No Document schema or Settings changes.
- Tests: pure scheduling/dedupe logic; component smoke tests.
- GitHub issue: https://github.com/puetsua/pansuthong/issues/13

## Platform notes

- **While running / backgrounded:** polling + OS-scheduled notifications cover arrivals on desktop and Android as far as the plugin allows.
- **App fully closed:** Android may still deliver OS-scheduled notifications; desktop Linux/Windows generally will not without a native background service — document this gap honestly in the PR.
