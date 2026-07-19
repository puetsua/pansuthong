## Context

Quick Capture is a desktop-only second window: created hidden in `lib.rs` setup, shown by `tauri-plugin-global-shortcut` on Ctrl+Shift+N, served from a separate Vite entry (`quick-capture.html` → `src/quick-capture/`). It calls the same `add_task` / `parseComposer` path as the main Composer. Because the capture window stays alive when hidden, closing the main window currently forces `app.exit(0)` so the process does not linger without a tray.

This change removes that entire surface. In-app capture via Composer stays.

## Goals / Non-Goals

**Goals:**

- Remove all Quick Capture UI, build entry, Tauri window, hotkey, and capability wiring.
- Remove the global-shortcut plugin if it has no remaining callers.
- Remove the main-window destroy → `exit(0)` workaround and the window-state denylist entry that existed only for the capture window.
- Leave Composer, shared parsers, and task creation behavior intact.
- Update specs/docs so agents no longer treat Quick Capture as part of the product.

**Non-Goals:**

- Replacing Quick Capture with another global hotkey or tray capture flow.
- Changing Composer UX, one-line parse syntax, or `add_task` APIs.
- Touching Android (feature never existed there).
- Migrating or rewriting user data (no Document/settings fields for Quick Capture).

## Decisions

1. **Delete the feature end-to-end rather than feature-flag it**  
   Rationale: It is already optional/convenience-only; keeping dead entry points and a second webview increases startup and maintenance cost.  
   Alternatives considered: Hide behind a setting (rejected — new Settings need approval and the goal is removal); leave the HTML entry but stop creating the window (rejected — dead build artifact).

2. **Drop `tauri-plugin-global-shortcut` with the feature**  
   Rationale: Grep shows it is only used for Quick Capture. Removing the dependency keeps desktop deps honest.  
   Alternatives considered: Keep the plugin registered with no handlers (rejected — unused dependency).

3. **Remove the main-window `Destroyed` → `exit(0)` handler**  
   Rationale: That handler exists solely because a hidden quick-capture window would otherwise keep the process alive. With only the main window, default Tauri lifecycle is enough.  
   Alternatives considered: Keep the handler “for safety” (rejected — unexplained special case after removal).

4. **Keep `parseComposer` / Rust parser mirror and Composer unchanged**  
   Rationale: Spec “One-line parsing” lived under `quick-capture` but the behavior is shared with Composer. Removal retires the capability; Composer continues to own in-app capture without a new spec in this change.  
   Alternatives considered: Move the parsing requirement into `task-management` now (deferred — out of scope for a removal; can be proposed separately if desired).

5. **Spec delta: REMOVED all `quick-capture` requirements**  
   Rationale: The capability is retired, not partially narrowed. Archive/sync will drop the main spec folder.

## Risks / Trade-offs

- [Desktop users who rely on Ctrl+Shift+N lose that path] → Mitigation: Composer in the main window remains; document as **BREAKING** desktop UX in the proposal/release notes.
- [Forgotten references break build or confuse agents] → Mitigation: Grep for `quick-capture` / `quickCapture` / `global_shortcut` after edits; update `docs/agent/repo-map.md`.
- [Capability JSON left registered] → Mitigation: Delete `src-tauri/capabilities/quick-capture.json` in the same change as `lib.rs` cleanup.

## Migration Plan

1. Implement removals on the `Pansuthong Dev` app only for verification.
2. Desktop smoke: launch main window, add a task via Composer, confirm Ctrl+Shift+N does nothing and no second window appears; closing main window exits the process.
3. Confirm Vite/Tauri build no longer emits `quick-capture` assets and Cargo builds without `tauri-plugin-global-shortcut`.
4. Rollback: revert the change commit(s); no data migration to undo.

## Open Questions

- None — removal scope is clear. If product later wants a global hotkey again, that is a new change.
