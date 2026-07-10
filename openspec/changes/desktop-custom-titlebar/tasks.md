## 1. Tauri window config + permissions

- [x] 1.1 Set `"decorations": false` on the main window in `src-tauri/tauri.conf.json` (and `tauri.dev.conf.json`, which desktop `tauri dev` merges over the windows entry)
- [x] 1.2 Add main-window permissions in `src-tauri/capabilities/default.json`: `core:window:allow-close`, `allow-minimize`, `allow-toggle-maximize`, `allow-start-dragging`

## 2. Titlebar UI

- [x] 2.1 Add a `DesktopTitlebar` (or equivalent) component: app icon, drag region, minimize / maximize-restore / close
- [x] 2.2 Wire controls with `@tauri-apps/api/window` (`minimize`, `toggleMaximize`, `close`); keep buttons outside the drag region
- [x] 2.3 Double-click drag region toggles maximize; keep maximize/restore icon in sync with window state
- [x] 2.4 Style with existing theme tokens (`--c-surface-2`, `--c-border`, control hover / close danger tint)

## 3. Shell integration

- [x] 3.1 Mount the titlebar from `DesktopShell` only; adjust shell CSS so content sits below the bar (no underlap)
- [x] 3.2 Confirm `MobileShell` / Android path does not render the desktop titlebar
- [x] 3.3 Expose the app icon asset to the frontend (reuse bundled icon from `src-tauri/icons` or a copied static asset)

## 4. Verify

- [x] 4.1 Manual desktop smoke: drag, double-click maximize, min/max/close, light and dark theme
- [x] 4.2 Confirm edge snap / `Win`+arrows still work; note snap-layout hover flyout as deferred (no plugin)
- [x] 4.3 Run any affected frontend tests / typecheck for touched files
