# Repo Map

## Frontend

- Routes/shell: `src/App.tsx`, `src/shell/`
- Active views: `src/views/TodayView.tsx`, `InboxView.tsx`, `UpcomingView.tsx`, `TagView.tsx`
- Archive/history: `src/views/ArchivedView.tsx`, `HistoryView.tsx`
- Templates/recurrence: `src/views/TemplatesView.tsx`, `src/lib/recurrence.ts`
- Editors: `src/components/TaskEditor.tsx`, `TagEditor.tsx`
- Rows/lists: `src/components/TaskRow.tsx`, `TaskList.tsx`, `GhostRow.tsx`
- Parser mirrors: `src/state/parse.ts`, `src-tauri/src/parse.rs`
- Locales: `src/i18n/locales/en.json`, `src/i18n/locales/zh-TW.json`

## Rust

- Setup/registration: `src-tauri/src/lib.rs`
- Model: `src-tauri/src/model.rs`
- Commands/validation: `src-tauri/src/commands.rs`
- Persistence: `src-tauri/src/store.rs`
- Local config: `src-tauri/src/config.rs`
- Watcher/conflicts: `src-tauri/src/sync.rs`, `conflict.rs`
- History sidecar: `src-tauri/src/history.rs`
- Android folder sync: `src-tauri/src/safsync.rs`
