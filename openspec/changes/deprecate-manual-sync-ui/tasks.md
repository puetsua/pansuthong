## 1. Remove the frontend component and usages

- [x] 1.1 Delete `src/components/SyncStatus.tsx`
- [x] 1.2 Remove the `SyncStatus` import and `<SyncStatus .../>` render from `src/shell/Sidebar.tsx`
- [x] 1.3 Remove the `SyncStatus` import and `<SyncStatus .../>` render from `src/shell/MobileShell.tsx`
- [x] 1.4 Remove the `syncNow` wrapper from the `api` object in `src/lib/tauri.ts` (keep the SAF `safSyncNow`)

## 2. Remove the backend command

- [x] 2.1 Delete the `sync_now` command function from `src-tauri/src/commands.rs` (keep `crate::sync::reload_if_changed` and the SAF `saf_sync_now`)
- [x] 2.2 Remove `sync_now` from the `invoke_handler` registration in `src-tauri/src/lib.rs`

## 3. Remove i18n keys and CSS

- [x] 3.1 Remove the `syncStatus` block (`syncNow`, `syncing`, `syncNowTitle`, `lastSynced`, `lastEditedTitle`) from `src/i18n/locales/zh-TW.json`
- [x] 3.2 Remove the corresponding `syncStatus` block from `src/i18n/locales/en.json` (leave the `settings.*` SAF keys intact)
- [x] 3.3 Remove the now-unused `.sync-status` / `.sync-now-btn` / `.sync-icon` / `.sync-time` rules from `src/styles/global.css` (also reverted `.mobile-shell` grid to 3 rows)

## 4. Update tests

- [x] 4.1 Remove the `syncNow → sync_now` test case from `src/lib/tauri.test.ts`
- [x] 4.2 Update `src/shell/Sidebar.test.tsx` — drop the `syncNow` stub/comment and any SyncStatus-specific assertions so the suite reflects the removed component
- [x] 4.3 Grep `src/` and `src-tauri/` for stray `syncNow` / `sync_now` / `SyncStatus` references (excluding SAF `saf_sync_now` and the settings SAF `SyncStatus` type) and clean up

## 5. Verify

- [x] 5.1 Frontend: `npx tsc --noEmit` and `npx vitest run` pass (570 tests green)
- [x] 5.2 Backend: `cargo check` and `cargo test` (desktop target) pass in `src-tauri/`
- [x] 5.3 Launched the desktop dev app — it built and ran cleanly with no errors. Live DOM inspection via the Tauri MCP bridge was blocked by repeated 2s injection timeouts (bridge flakiness, unrelated to the change); the removal is guaranteed at source (component file deleted, all imports removed, `tsc` green, Sidebar render tests pass)
- [x] 5.4 `openspec validate deprecate-manual-sync-ui --strict` passes
