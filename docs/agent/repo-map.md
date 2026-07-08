# Repo Map

## Frontend

- Routes/shell: `src/App.tsx`, `src/shell/`
- Active views: `src/views/TodayView.tsx`, `InboxView.tsx`, `UpcomingView.tsx`, `TagView.tsx`
- Archive/history: `src/views/ArchivedView.tsx`, `HistoryView.tsx`
- Templates/recurrence: `src/views/TemplatesView.tsx`, `src/lib/recurrence.ts`
- Capture: `src/components/Composer.tsx` (inline add in Today/Inbox/Tag views; one-line parse + `ComposerPreview.tsx`) opens the full `TaskEditor.tsx` modal
- Editors: `src/components/TaskEditor.tsx`, `TagEditor.tsx`
- Rows/lists: `src/components/TaskRow.tsx`, `TaskList.tsx`, `RowList.tsx`, `GhostRow.tsx`
- List filters/paging (shared by Archived + History): `src/components/ListControls.tsx` (`DateRangeFilters` etc.), `src/lib/listPaging.ts` (`usePagedItems`, `PAGE_SIZES`)
- Parser mirrors: `src/state/parse.ts`, `src-tauri/src/parse.rs`
- Locales: `src/i18n/locales/en.json`, `src/i18n/locales/zh-TW.json`

## Frontend Subsystems

- Quick Capture: second Vite entry point — `quick-capture.html` -> `src/quick-capture/` (`main.tsx`, `QuickCapture.tsx`). Standalone capture window; keep the extra `rollupOptions.input` in `vite.config.ts` when touching the build.
- Theming: `src/lib/themes.ts` (presets + token resolution; Rust stores only opaque preset strings). UI: `ThemePickerModal.tsx`, `ThemeEditorModal.tsx`, `ThemeSettings.tsx`, `ThemePreview.tsx`; tokens in `src/styles/tokens.css`.
- Time tracking: `src/lib/time.ts` (running/finished `TimeEntry` intervals, concurrent timers). UI: `TimeTracking.tsx`, `TimeEstimateReminder.tsx`.
- Idle assignment: `src/lib/useIdleAnchor.ts` (session-local idle anchor; not synced) + `AssignIdle.tsx`, `IdleStatus.tsx` to assign untracked time to tasks.
- Analytics/heatmaps: `src/lib/tag-analytics.ts`, `src/lib/recurrence-heatmap.ts`, `HeatmapGrid.tsx` (Tag stats tab + Dashboard).

## Rust

- Setup/registration: `src-tauri/src/lib.rs`
- Model: `src-tauri/src/model.rs`
- Commands/validation: `src-tauri/src/commands.rs`
- Persistence: `src-tauri/src/store.rs` (in-memory `Document` + merge/reload) over `src-tauri/src/db.rs` (SQLite schema, `Document` <-> DB, `quick_check` read, version gate)
- Local config: `src-tauri/src/config.rs`
- Watcher/conflicts: `src-tauri/src/sync.rs`, `conflict.rs`
- History sidecar: `src-tauri/src/history.rs`
- Android folder sync: `src-tauri/src/safsync.rs`
