## Why

Changing the data folder on desktop always shows the same Copy / Move dialog, whose
three-paragraph explanation users find hard to follow (#253). Worse, when the target
folder already holds Pansuthong data, the store adopts that folder's document and
silently drops the current one, and choosing **Move** then deletes this device's
files from the old folder — the user's current tasks end up in neither folder.

## What Changes

- Add a backend check that reports whether a candidate folder (or the default
  location) already holds Pansuthong task data, so the UI can ask the right question.
- Target **without** Pansuthong data: the dialog asks whether to keep the old copy —
  **Keep both** (copy, primary) · **Remove from old** (move) · **Cancel**.
- Target **with** Pansuthong data: the dialog asks whether to merge —
  **Merge** (primary) · **Use folder's data** · **Cancel**.
- New **Merge** transfer mode: the current document is merged with the target's
  replicas (entity-level LWW + tombstones, same as peer sync) instead of being
  discarded; own history and referenced attachments are filled in where missing.
- New **Adopt** transfer mode ("Use folder's data"): today's adopt behavior.
- **BREAKING (internal API)**: when the target already holds data, the backend
  rejects `copy` / `move`; nothing is ever deleted from the old folder on the
  merge/adopt path. This closes the Move data-loss bug.
- Clearing back to the default location runs the same check.
- Shorter, outcome-first dialog copy in both locales (one sentence per variant).

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `multi-device-sync`: Relocatable data folder — split seed (Copy/Move) from
  existing-data (Merge/Adopt) choices; adopt/merge never removes old-folder files.
- `settings-and-appearance`: Data-folder transfer confirmation dialog — two dialog
  variants chosen by a target inspection, new labels and shorter copy.
- `attachments`: Own attachments follow folder relocate — Move cleanup applies only
  to the seed path; merge/adopt fill missing referenced blobs and never delete.

## Impact

- `src-tauri/src/store.rs`: `TransferMode` gains `Merge` / `Adopt`; `repoint`
  branches on them; new target-inspection helper.
- `src-tauri/src/commands.rs` + `lib.rs`: new `inspect_data_folder` command;
  `set_data_folder` / `clear_data_folder` validate the mode.
- `src/lib/tauri.ts`, `src/components/settings/DataFolderSection.tsx`,
  `src/i18n/locales/{en,zh-TW}.json`, `SettingsView.test.tsx`, `tauri.test.ts`.
- Desktop only; Android SAF linking is unchanged.
