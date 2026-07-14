## Why

The sidebar/mobile "立即同步" (Sync now) button and "上次同步" (Last synced) indicator no
longer earn their place. The backend already keeps peer data fresh automatically via a
filesystem watcher plus a 2s polling fallback, so the manual button only shaves off up to
~2s. Worse, it re-reads *local disk only* — it cannot force a cloud client (e.g. Google
Drive) to pull a peer's change faster, so in the exact case a user reaches for it, it does
nothing but offer false reassurance. The "上次同步" label is also mislabeled: it renders
`doc.last_modified` (last *edit* time), not an actual sync time.

## What Changes

- Remove the `SyncStatus` component (`src/components/SyncStatus.tsx`) and its usages in the
  desktop sidebar (`Sidebar.tsx`) and mobile shell (`MobileShell.tsx`).
- Remove the `sync_now` Tauri command (`commands.rs`) and its registration (`lib.rs`), plus
  the `api.syncNow` wrapper (`src/lib/tauri.ts`).
- Remove the `syncStatus.*` i18n keys from `en.json` and `zh-TW.json`.
- Remove the now-unused `sync-status` / `sync-now-btn` / `sync-icon` / `sync-time` CSS.
- Remove/adjust related tests (`Sidebar.test.tsx`, `tauri.test.ts` `syncNow`).
- **BREAKING (spec):** drop the "Manual sync re-reads immediately" scenario from the
  multi-device-sync spec's "Watcher and polling fallback" requirement. Automatic
  watch + poll remains the sole freshness mechanism.

Non-goals: the automatic watcher + polling fallback are unchanged. The Android SAF
folder-sync UI in Settings (`settings.syncNow` / `settings.lastSynced`, `saf_sync_now`) is a
separate mechanism and is **not** touched.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `multi-device-sync`: the "Watcher and polling fallback" requirement drops its manual
  `sync_now` scenario; freshness is guaranteed solely by the watcher and periodic poll.

## Impact

- Frontend: `src/components/SyncStatus.tsx` (deleted), `src/shell/Sidebar.tsx`,
  `src/shell/MobileShell.tsx`, `src/lib/tauri.ts`, `src/i18n/locales/{en,zh-TW}.json`,
  CSS, and tests (`Sidebar.test.tsx`, `tauri.test.ts`).
- Backend: `src-tauri/src/commands.rs` (`sync_now` removed), `src-tauri/src/lib.rs`
  (handler registration removed). The underlying `crate::sync::reload_if_changed` stays —
  it is still used by the watcher/poll path.
- No data-model or on-disk format change; fully backward compatible.
