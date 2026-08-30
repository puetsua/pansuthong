## Why

While a timer is running, Pansuthong never notices that the user walked away or locked the screen. The open interval keeps accruing until they hit Stop, so AFK time is silently billed as work. After returning, the app should warn and let them keep or discard that span — and discarding must stop tracking, not leave a new open interval.

## What Changes

- Detect OS-level idle input (keyboard/mouse) while any timer is running on desktop (Windows and Linux). Android is unchanged.
- After the user returns from AFK, show an in-app dialog (not an OS notification, not the existing idle-assignment UI) with the AFK duration and two choices: **Keep** or **Discard**.
- **Keep:** leave running intervals as-is (AFK time stays in the entries); timers continue. If the prompt was shown because they hit Stop, Keep still includes the AFK span and then stops that task at now.
- **Discard:** close every running interval at the start of the AFK span (or drop the entry if it started at/after AFK), leave no open interval, and stop time tracking. The same choice applies to every task that was timing during the AFK span.
- If they hit Stop after a long AFK without having seen the return prompt, show the same dialog before closing at "now".
- AFK threshold is a fixed default (no new Settings control).
- Existing "Idle N" / Assign idle (untracked time when **no** timer is running) is unchanged.

## Capabilities

### New Capabilities

- (none)

### Modified Capabilities

- `time-tracking`: add AFK-while-running detection and a keep/discard prompt that stops tracking when the AFK span is discarded.

## Impact

- Desktop Rust: last-input idle query (Windows `GetLastInputInfo`, Linux X11 ScreenSaver / best-effort session idle). New commands to read idle time and discard running AFK spans.
- Frontend: new dialog + poll while timers run; intercept Stop so AFK is not closed at "now" without a prompt. Locales (en, zh-TW).
- Model: discard-at-AFK-start on running entries; no Document schema change.
- No Settings, no synced idle state, no Android behavior change.
- Tests: model discard, idle command/platform stubs, dialog keep/discard/stop-intercept.
- GitHub issue: https://github.com/puetsua/pansuthong/issues/170
