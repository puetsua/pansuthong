## 1. Backend transfer mode

- [x] 1.1 Add `transfer_mode: Copy | Move` to `set_data_folder` / `clear_data_folder` (or shared helper) and thread it into `AppState::repoint`
- [x] 1.2 Ensure seed path copies own history + own `attachments_<device>/` (reuse or absorb `copy_own_attachments` from `repoint-copy-attachments` if present); leave sources intact under Copy
- [x] 1.3 Implement Move cleanup: after successful own-payload transfer, delete only this device's `tasks_<device>.*`, `history_<device>.jsonl`, and `attachments_<device>/` from the old folder; never touch peer files
- [x] 1.4 Adopt path: no wholesale history overwrite; fill-missing own attachments only; Move still only cleans the old folder's own files
- [x] 1.5 On transfer failure under Move, skip old-folder cleanup; warn-and-continue for non-fatal sidecar copy under Copy (parity with history)

## 2. Desktop Settings dialog

- [x] 2.1 Add minimal in-app modal (explanation + Copy / Move / Cancel) before `set_data_folder` / `clear_data_folder` when seeding or leaving own local data; Cancel aborts with no invoke
- [x] 2.2 Wire `pickAndSetDataFolder` / `clearDataFolder` to pass the chosen transfer mode; i18n en + zh-TW strings
- [x] 2.3 Prefer Copy as the safe primary action; do not use `window.confirm` (WebView2); mirror existing in-app dialog patterns

## 3. Tests

- [x] 3.1 Rust: seed Copy copies own history/attachments and leaves sources; seed Move removes own payload only; peers untouched
- [x] 3.2 Rust: adopt does not overwrite target blobs/history wholesale; Move cleans old own files only; failed transfer skips cleanup
- [x] 3.3 Frontend: dialog Cancel does not invoke; Copy/Move invoke with the correct mode (SettingsView / tauri API tests)

## 4. Specs and related work

- [x] 4.1 Keep change deltas aligned with implementation; on archive, sync main `multi-device-sync`, `attachments`, `settings-and-appearance`
- [x] 4.2 Reconcile with `repoint-copy-attachments` / #133 / PR #134 at apply time (reuse helpers or absorb remaining P0; supersede silent-copy UX); Android SAF transfer dialog remains out of scope for v1

## 5. Verify

- [x] 5.1 Run focused Rust + frontend tests for repoint/transfer and Settings dialog
- [x] 5.2 Smoke on Pansuthong Dev only: Copy to empty folder (old intact); Move to empty folder (own gone, peers remain); Cancel; clear back to app-data with dialog
