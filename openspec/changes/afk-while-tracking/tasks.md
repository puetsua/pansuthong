## 1. Rust idle query and discard

- [x] 1.1 Add desktop last-input idle helper (`session_idle_ms`) — Windows `GetLastInputInfo`, Linux X11 ScreenSaver with best-effort fallback; Android returns `None`
- [x] 1.2 Add `Task::discard_running_afk(afk_start)` (close at AFK start, or drop the entry if `start >= afk_start`) and cover it with model tests
- [x] 1.3 Add `session_idle_ms` and `discard_running_afk` commands, register them, wrap idle in the TS API

## 2. Frontend prompt and stop intercept

- [x] 2.1 Add `AfkWhileTracking` (poll while timers run, 5-minute threshold, blocking Keep/Discard dialog) and mount it in `App`
- [x] 2.2 Intercept Stop (`requestStopTimer`) so a long AFK without a prompt still shows the dialog; Keep after Stop closes that task at now; Discard applies to every running task
- [x] 2.3 Add en and zh-TW strings; do not reuse Assign idle copy or UI

## 3. Tests

- [x] 3.1 Frontend tests: return-from-AFK Keep/Discard, multi-task Discard, Stop intercept, no prompt when idle is unavailable
- [x] 3.2 `npm test -- AfkWhileTracking TaskRow TimeTracking` and `cargo test --manifest-path src-tauri/Cargo.toml -j 1` for the new model tests
