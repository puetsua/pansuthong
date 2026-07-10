## Why

Quick Capture is a desktop-only convenience (hidden always-on-top window + Ctrl+Shift+N) that adds a second Vite entry, a dedicated capability, and a global-shortcut plugin — while the main Composer already covers one-line task capture. Removing it shrinks the desktop surface area and startup path without taking away in-app capture.

## What Changes

- **BREAKING** (desktop UX): Remove the standalone Quick Capture window and the Ctrl+Shift+N global shortcut that shows it.
- Delete the second Vite entry (`quick-capture.html` → `src/quick-capture/`) and stop emitting that build artifact.
- Remove the Tauri quick-capture window setup, capability file, window-state denylist entry, and the main-window `exit(0)` workaround that existed only because the hidden capture window kept the process alive.
- Drop `tauri-plugin-global-shortcut` if nothing else uses it after this removal.
- Remove Quick Capture i18n strings and agent/docs mentions of the second entry point.
- Keep the main-app Composer, `parseComposer` / Rust one-line parser mirror, and normal `add_task` path unchanged.

## Capabilities

### New Capabilities

- (none)

### Modified Capabilities

- `quick-capture`: Retire the capability — remove requirements for the standalone window, second Vite entry, and the capture-window-scoped one-line parsing contract (in-app Composer parsing remains as implementation, not under this capability).

## Impact

- Frontend: delete `quick-capture.html`, `src/quick-capture/`; remove `rollupOptions.input["quick-capture"]` from `vite.config.ts`; drop `quickCapture.*` keys from `en.json` / `zh-TW.json`.
- Backend: strip quick-capture window + hotkey setup from `src-tauri/src/lib.rs`; delete `src-tauri/capabilities/quick-capture.json`; likely remove `tauri-plugin-global-shortcut` from `Cargo.toml` / lockfile; simplify window-state denylist and main-window destroy exit handler.
- Docs: update `docs/agent/repo-map.md` (and any other mentions).
- Specs: delta under `openspec/changes/remove-quick-capture/specs/quick-capture/` that REMOVEs all current requirements; main `openspec/specs/quick-capture/` is retired on archive/sync.
- No Document / settings / sync model changes; no new Settings controls.
- Android unchanged (Quick Capture was never created on mobile).
