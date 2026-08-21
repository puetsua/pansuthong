## Why

Launching Pansuthong while it is already running opens a second desktop window and a second process. Two copies of the same identifier fighting over the same data folder is confusing and can contend on the SQLite store. A second launch should restore and focus the existing window instead.

## What Changes

- Keep at most one running desktop process per app identifier.
- When the user launches the app and an instance of that identifier is already running, the new process exits without creating another window, and the existing main window is restored (if minimized) and focused.
- Production (`Pansuthong`, `net.puetsua.pansuthong`) and development (`Pansuthong Dev`, `net.puetsua.pansuthong.dev`) stay independent — they MAY run at the same time.
- Android is unchanged; instance handling stays with the OS.

## Capabilities

### New Capabilities

- (none)

### Modified Capabilities

- `desktop-window-chrome`: add a single-desktop-instance requirement so a second launch focuses the existing main window instead of opening another.

## Impact

- Desktop Rust: `src-tauri/src/lib.rs` (plugin registration + focus callback), `src-tauri/Cargo.toml` / `Cargo.lock`.
- New desktop-only dependency: `tauri-plugin-single-instance`.
- No frontend, Document, settings, or Android changes. No new Settings controls.
- No capabilities/ACL change — the plugin has no JavaScript API.
