## Context

Time tracking stores open `time_entries` (no `end`) as the running timer. `start_timer` appends one; `stop_timer` always closes it at "now". There is no last-input / idle-input detection.

Existing idle UI (`useIdleAnchor` / `IdleStatus` / `AssignIdle`) is the opposite case: untracked time when **no** timer is running, so the user can attach forgotten work. It must not be reused for AFK-while-running.

The prompt needs an in-app choice. Estimate reminders (`TimeEstimateReminder`) are OS notifications only and are not a substitute.

## Goals / Non-Goals

**Goals:**

- Detect AFK from OS last-input while at least one timer is running (desktop).
- After return, or if the user hits Stop after a long AFK without a prompt, show a blocking in-app Keep / Discard dialog that states the AFK duration.
- Keep leaves AFK time in the open interval. Discard closes every running interval at AFK start (or drops a zero-length one) and leaves no open interval.
- One choice applies to every task that was timing during the AFK span.
- Fixed threshold; no new Settings control.

**Non-Goals:**

- Android AFK detection (unspecified; idle query returns unavailable).
- Changing Assign idle / IdleStatus.
- Configurable threshold or other Settings.
- OS notification as the only prompt.
- Detecting "app unfocused but user still at the machine" as AFK (last-input is system-wide).
- Intercepting Complete (mark done) as a separate AFK prompt.

## Decisions

### 1. OS last-input, 5-minute threshold

- **Choice:** Poll milliseconds since last keyboard/mouse input. AFK starts at that last-input instant once idle ≥ 5 minutes. The AFK span shown and discarded is `now - last_input`, not `now - (last_input + threshold)`.
- **Why:** Matches "walk away or lock the screen". Five minutes is a common tracker default; issue forbids a new Settings control unless decided separately.
- **Windows:** `GetLastInputInfo` (system-wide, including while Pansuthong is in the background or the session is locked).
- **Linux:** X11 `XScreenSaverQueryInfo` when a display is available; otherwise best-effort session idle (e.g. freedesktop ScreenSaver) and `None` if nothing works (typical unprivileged Wayland).
- **Android / unavailable:** command returns `null`; frontend does not prompt.
- **Alternatives:** Webview-only mousemove — misses lock-screen and other-app use. Instant AFK on lock — nicer on lock, but walk-away still needs a threshold; last-input covers both.

### 2. Frontend poll + in-app dialog, separate from Assign idle

- **Choice:** Mount an `AfkWhileTracking` component next to `TimeEstimateReminder`. Poll idle only while a timer is running. On crossing the threshold, remember `afk_since = now - idle_ms`. When idle drops again (user returned) with that memory, open a `.te-confirm` dialog. No Escape / backdrop dismiss — Keep or Discard is required.
- **Why:** Issue asks for an in-app choice and forbids overloading Assign idle. Session-local UI state; nothing new in `Document` or `config.json`.
- **Alternatives:** Rust event emission — extra plumbing for the same poll. Native dialog plugin — worse i18n/theming.

### 3. Discard is one command over all running tasks

- **Choice:** `discard_running_afk(afk_start_ms)` walks every task with an open interval: if `start >= afk_start`, delete the entry; else set `end = afk_start`. Persist once, emit store-changed. Keep is a no-op on data.
- **Why:** Several concurrent timers must take the same choice atomically. Reusing N× `stop_timer`/`update_time_entry` races and can create zero-length rows.
- **Stop intercept:** `requestStopTimer` asks the AFK gate first. If idle ≥ threshold (or a prompt is already pending), show the dialog instead of `stop_timer` at now. **Keep** after a Stop trigger then `stop_timer`s that one task at now (AFK included); other running tasks continue. **Discard** still applies to every running task and does not call `stop_timer`.
- **Return trigger Keep:** timers stay open, AFK time remains.
- **Alternatives:** Close only the task they stopped — contradicts "same choice to each".

### 4. No schema / Settings change

- **Choice:** Idle query and prompt state are device-session only. Threshold is a frontend constant (`AFK_THRESHOLD_MS`).
- **Why:** Settings require explicit approval; AFK is not synced data.

## Risks / Trade-offs

- **[Risk] Wayland has no last-input API** → Return `None` and skip the prompt rather than false positives from webview events. X11 and Windows are the reliable paths.
- **[Risk] First input after AFK is Stop** → Intercept Stop using current idle (not only the "returned" edge) so the span is not closed at now before the dialog.
- **[Risk] Clock / last-input wrap on Windows `GetTickCount` 32-bit** → Use wrapping subtraction.
- **[Risk] Polling X11 every second is chatty** → Cache the display connection; skip polls when nothing is timing.
- **[Risk] Completing a task while AFK still closes at now** → Accepted; Complete is out of scope.

## Migration Plan

- Ship in the next desktop build. No data migration.
- Rollback: remove the dialog, idle module, and `discard_running_afk` command; existing entries are unchanged.

## Open Questions

- None blocking. Threshold can become a setting later if we decide that separately.
