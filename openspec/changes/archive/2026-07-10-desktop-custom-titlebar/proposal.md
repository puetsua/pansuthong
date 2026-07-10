## Why

The main desktop window uses the OS titlebar, which does not match the app's themed shell (sidebar + content). A custom titlebar — like VS Code — makes the window chrome feel continuous with the UI and keeps light/dark appearance consistent.

## What Changes

- Disable OS window decorations on the **main** desktop window.
- Add a custom titlebar in `DesktopShell`: **app icon** on the left, **drag region** in the middle, **minimize / maximize-restore / close** on the right.
- Wire window controls via Tauri window APIs and grant the needed main-window capabilities.
- Theme the titlebar with existing design tokens so it follows light/dark (and custom presets).
- **Out of scope:** Android, Win11 snap-layout hover flyout (deferred follow-up), title/view text in the bar.

## Capabilities

### New Capabilities

- `desktop-window-chrome`: Custom frameless main-window titlebar (icon + drag + window controls) on desktop only.

### Modified Capabilities

- (none)

## Impact

- Config: `src-tauri/tauri.conf.json` (`decorations: false` on main).
- Capabilities: `src-tauri/capabilities/default.json` (close / minimize / toggle-maximize / start-dragging).
- Frontend: new titlebar component mounted from `DesktopShell`; CSS using existing tokens; layout so content sits below the bar.
- No Document / settings / sync model changes; no new Settings controls.
- Android unchanged (mobile shell has no desktop titlebar).
