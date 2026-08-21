## Context

Desktop Pansuthong currently has no single-instance guard. Each launch creates a new process and a new main window. Production (`net.puetsua.pansuthong`) and development (`net.puetsua.pansuthong.dev`) already use distinct identifiers and product names; that split should keep working. Android instance lifetime is owned by the OS.

The main window starts `visible: false` until the frontend paints and calls `show_main_window`. There is no tray; closing the main window exits the app. The interesting second-launch cases are a visible window and a minimized window.

## Goals / Non-Goals

**Goals:**

- One running desktop process per app identifier.
- A second launch of that identifier exits immediately and restores + focuses the existing main window (including when it is minimized).
- Prod and Dev remain independent instances.
- Plugin is desktop-only and does not land on the Android target.

**Non-Goals:**

- Deep-link / argv forwarding (no URL scheme today).
- Hide-to-tray or close-to-tray.
- Forcing a single instance across prod and Dev.
- New Settings controls or frontend APIs.
- Changing first-paint hide/show (`show_main_window`).

## Decisions

### 1. Use `tauri-plugin-single-instance` (desktop only)

- **Choice:** Add `tauri-plugin-single-instance = "2"` under the existing desktop-only target deps (`cfg(not(any(target_os = "android", target_os = "ios")))`). Register it as the **first** plugin on the desktop builder, matching Tauri's docs. Callback restores the `"main"` webview: `unminimize`, `show`, `set_focus`.
- **Why:** Official Tauri 2 plugin; mutex / WM_COPYDATA (Windows) and DBus (Linux) already keyed by bundle identifier, so prod vs Dev isolation is free. Second-instance `SendMessage` runs the callback while the launching process is still foreground, which is what Windows needs for `SetForegroundWindow` to succeed. `unminimize` is required because `set_focus` alone does not restore a minimized window.
- **Alternatives:** Hand-rolled named mutex — more code, same OS work. Gate on `not(debug_assertions)` — would leave `Pansuthong Dev` (debug builds) opening duplicate windows, which is the app we test.

### 2. No capabilities / no JS API

- **Choice:** Do not add a capability file or frontend permission. Focus happens in the Rust callback.
- **Why:** The plugin exposes no JavaScript commands; Tauri docs say capabilities are not required.
- **Alternatives:** A frontend `onSecondInstance` listener — extra surface for no product need.

### 3. Do not enable the plugin's `semver` or `deep-link` features

- **Choice:** Default features only.
- **Why:** Two installed versions of the same identifier should still collapse to one process. There is no deep-link scheme to forward.

## Risks / Trade-offs

- **[Risk] `tauri dev` rebuild races the mutex** — if the old process has not released the lock when the new binary starts, the new process exits. → Accept; kill the leftover `Pansuthong Dev` process and relaunch. Same identifier isolation still lets prod and Dev coexist.
- **[Risk] Second launch during the initial `visible: false` paint** — `show()` may reveal the window a moment before the frontend's `show_main_window`. → Brief; better than a second window.
- **[Risk] Windows focus steal fails when the second process is not foreground** — `SetForegroundWindow` is denied unless the caller is already foreground (a second launch from a shortcut is; a launch from another process often is not). → After `unminimize`/`show`/`set_focus`, briefly flip `always_on_top` on Windows so z-order still raises the window.

## Migration Plan

- Ship in the next desktop build. No data migration.
- Rollback: drop the plugin registration and the desktop crate dep.

## Open Questions

- None blocking.
