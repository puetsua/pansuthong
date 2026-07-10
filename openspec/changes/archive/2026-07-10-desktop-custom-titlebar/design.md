## Context

The main window is configured in `tauri.conf.json` with default OS decorations. `DesktopShell` is a two-column grid (sidebar + main) with no top chrome. Theme tokens already drive light/dark (and custom presets). Quick Capture has been removed from the product. Android uses `MobileShell` and must not grow desktop titlebar UI.

## Goals / Non-Goals

**Goals:**

- Frameless main window on desktop with a custom titlebar: app icon | drag region | min / max-restore / close.
- Titlebar themed with existing CSS tokens so it matches the shell.
- Double-click drag region toggles maximize; maximize button reflects restored vs maximized.
- Desktop-only UI mount via `DesktopShell`.

**Non-Goals:**

- Win11 snap-layout hover flyout (deferred; stock maximize/snap-by-drag/`Win`+arrows remain).
- Title or view name text in the bar.
- Menu bar, traffic lights inset, or macOS-specific transparent titlebar work (Windows is the primary desktop target; keep controls cross-desktop-simple).
- Android chrome changes.
- New Settings controls.

## Decisions

### 1. Config-level `decorations: false` on main

- **Choice:** Set `"decorations": false` on the main window in both `tauri.conf.json` and `tauri.dev.conf.json` (desktop `npm run tauri dev` merges the latter and replaces the windows entry). Exclude `StateFlags::DECORATIONS` from `tauri-plugin-window-state` so a saved `decorated: true` cannot override the config.
- **Why:** Main window is declared in config; keeps startup simple. Android does not use this desktop chrome path. Dev overlay must repeat the flag or OS chrome returns. Window-state previously restored decorations and undid frameless mode.
- **Alternatives:** Build main window in Rust at runtime — unnecessary for a static flag.

### 2. Titlebar lives in `DesktopShell` only

- **Choice:** New `Titlebar` (or `DesktopTitlebar`) component rendered as the first child of `DesktopShell`; adjust shell CSS to a top row + content grid.
- **Why:** `App` already picks `DesktopShell` vs `MobileShell`; Android never mounts the titlebar.
- **Alternatives:** Global layout in `App` — would need platform gating and risks mobile layout bugs.

### 3. Layout: icon + drag + controls

- **Choice:** Left: app icon (existing bundle icon, sized to the bar). Center/flex: drag region (`data-tauri-drag-region` and/or `startDragging` with double-click → `toggleMaximize`). Right: minimize, maximize/restore, close — not part of the drag region.
- **Why:** Matches the agreed product shape; keeps interactive buttons outside the drag hit-target.
- **Alternatives:** Empty bar with no icon — rejected; icon-only branding was requested.

### 4. Window API + capabilities

- **Choice:** Use `@tauri-apps/api/window` (`getCurrentWindow`: `minimize`, `toggleMaximize`, `close`, listen `onResized` / `isMaximized` for icon state). Add permissions: `core:window:allow-close`, `allow-minimize`, `allow-toggle-maximize`, `allow-start-dragging` (and keep `core:default`).
- **Why:** Same pattern as the Tauri window-customization guide; capabilities are required in Tauri 2.
- **Alternatives:** Rust-only commands — more glue for no benefit.

### 5. Defer snap-layout plugin

- **Choice:** No `tauri-plugin-snap-layout` / frame plugin in this change.
- **Why:** Hover flyout is optional polish; edge snap and keyboard snap still work without it. Can add later over the maximize button.
- **Alternatives:** Ship plugin now — extra dependency before we know users miss the flyout.

### 6. Visual styling

- **Choice:** Height ~32px; background `var(--c-surface-2)` (or matching sidebar); bottom border `var(--c-border)`; control hover states using existing surface/danger tokens (close hover can use a red tint).
- **Why:** Continuity with sidebar chrome without inventing new tokens or Settings.
- **Alternatives:** Separate titlebar color setting — rejected (no new Settings).

## Risks / Trade-offs

- **[Risk] Win11 maximize-hover snap flyout missing** → Accept for v1; document as follow-up; edge/`Win`+arrow snap still work.
- **[Risk] Drag region swallows clicks on icon** → Include icon in drag region (decorative) or make icon non-interactive; keep controls outside drag.
- **[Risk] Content underlaps titlebar** → Shell CSS must reserve titlebar height (grid row / padding), not `position: fixed` over content without offset.
- **[Risk] Maximized state icon stale** → Subscribe to window resize / focus events and refresh `isMaximized()`.

## Migration Plan

- No data migration. Ship with decorations off; users see the new chrome on next desktop build.
- Rollback: restore `decorations: true` and remove the titlebar component.

## Open Questions

- None blocking. Icon asset: reuse `src-tauri/icons` / bundled app icon exposed to the frontend (implementation detail at apply time).
