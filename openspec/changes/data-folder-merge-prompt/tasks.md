## 1. Backend: store

- [x] 1.1 Add `Merge` and `Adopt` variants to `TransferMode` (serde lowercase)
- [x] 1.2 Factor target detection out of `repoint` into `target_docs(path)` and a public `folder_has_data(path)`
- [x] 1.3 In `repoint`, reject Copy/Move with `AppError::Invalid` when the target has data, before any write
- [x] 1.4 In `repoint`, Merge folds the current document into `merge_documents`; Adopt keeps today's behavior; Merge/Adopt on an empty target seed with Copy semantics
- [x] 1.5 Add `merge_own_history` (exact-line union) in `history.rs` and use it on Merge; Adopt copies no history; never call `remove_own_payload` on the existing-data path
- [x] 1.6 Convert existing repoint tests that hit a non-empty target to Adopt/Merge; turn `repoint_adopt_move_cleans_old_own_files_only` into a rejection test
- [x] 1.7 New Rust tests: merge keeps both tasks, merge/adopt leave old folder intact, merge/adopt on empty target seeds, merge history union, merge fills missing attachment, `folder_has_data` cases

## 2. Backend: commands

- [x] 2.1 Add `inspect_data_folder(folder: Option<String>) -> DataFolderInspection { has_data, is_current }` in `commands.rs` (None = default dir; non-directory = invalid input)
- [x] 2.2 Register it in `lib.rs` `generate_handler!` (desktop and Android builds compile)

## 3. Frontend

- [x] 3.1 `src/lib/tauri.ts`: widen `TransferMode`, add `DataFolderInspection` type and `api.inspectDataFolder`
- [x] 3.2 `DataFolderSection.tsx`: inspect after picking / on Use default location; render the dialog variant by `hasData`; map buttons to copy/move or merge/adopt; inspection errors go to the error line
- [x] 3.3 Update `en.json` and `zh-TW.json` with the new title, body, and button strings for both variants; remove the obsolete transfer strings; reword `desktopHint` (adopting is now a choice)
- [x] 3.4 Update `SettingsView.test.tsx` (both variants, every button's mode, cancel, clear path, inspect error) and `tauri.test.ts`
- [x] 3.5 Update `docs/ui-terms.html` data-folder dialog entries

## 4. Verify

- [x] 4.1 `npm test`, `npm run build`, `npm run lint`
- [x] 4.2 `cargo test --manifest-path src-tauri/Cargo.toml -j 1 --lib` (integration tests do not touch repoint) and `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`
- [x] 4.3 `openspec validate data-folder-merge-prompt --strict`
