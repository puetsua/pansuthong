## 1. Remove the frontend component and usages

- [ ] 1.1 Delete `src/components/SyncStatus.tsx`
- [ ] 1.2 Remove the `SyncStatus` import and `<SyncStatus .../>` render from `src/shell/Sidebar.tsx`
- [ ] 1.3 Remove the `SyncStatus` import and `<SyncStatus .../>` render from `src/shell/MobileShell.tsx`
- [ ] 1.4 Remove the `syncNow` wrapper from the `api` object in `src/lib/tauri.ts` (keep the SAF `safSyncNow`)

## 2. Remove the backend command

- [ ] 2.1 Delete the `sync_now` command function from `src-tauri/src/commands.rs` (keep `crate::sync::reload_if_changed` and the SAF `saf_sync_now`)
- [ ] 2.2 Remove `sync_now` from the `invoke_handler` registration in `src-tauri/src/lib.rs`

## 3. Remove i18n keys and CSS

- [ ] 3.1 Remove the `syncStatus` block (`syncNow`, `syncing`, `syncNowTitle`, `lastSynced`, `lastEditedTitle`) from `src/i18n/locales/zh-TW.json`
- [ ] 3.2 Remove the corresponding `syncStatus` block from `src/i18n/locales/en.json` (leave the `settings.*` SAF keys intact)
- [ ] 3.3 Remove the now-unused `.sync-status` / `.sync-now-btn` / `.sync-icon` / `.sync-time` rules from `src/styles/global.css`

## 4. Update tests

- [ ] 4.1 Remove the `syncNow → sync_now` test case from `src/lib/tauri.test.ts`
- [ ] 4.2 Update `src/shell/Sidebar.test.tsx` — drop the `syncNow` stub/comment and any SyncStatus-specific assertions so the suite reflects the removed component
- [ ] 4.3 Grep `src/` and `src-tauri/` for stray `syncNow` / `sync_now` / `SyncStatus` references (excluding SAF `saf_sync_now` and the settings SAF `SyncStatus` type) and clean up

## 5. Verify

- [ ] 5.1 Frontend: `npx tsc --noEmit` and `npx vitest run` pass
- [ ] 5.2 Backend: `cargo check` and `cargo test` (desktop target) pass in `src-tauri/`
- [ ] 5.3 Run the dev app and confirm the sidebar and mobile shell no longer show the Sync-now button / Last-synced label, and that peer changes still surface automatically
- [ ] 5.4 `openspec validate deprecate-manual-sync-ui --strict` passes
