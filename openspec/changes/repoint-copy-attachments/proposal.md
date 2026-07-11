## Why

When the user relocates the data folder to an empty directory, `AppState::repoint` seeds the document and copies this device's history sidecar — but it does **not** copy `attachments_<device>/` blobs. That is an oversight, not intentional: seeded tasks can reference attachments that no longer exist beside the new data file, so opens fail until blobs are re-added or synced from elsewhere.

## What Changes

- **P0 — Seed empty folder:** When `repoint` seeds an empty target, **copy** (not move) this device's `attachments_<device>/` tree from the old folder to the new folder, mirroring `copy_own_history`. Leave the source intact; do **not** copy peer `attachments_<other>/` directories.
- **P1 — Adopt existing folder (optional / follow-up in same change or deferred):** When adopting a folder that already has task data, do not overwrite peer or existing blobs; optionally copy only blobs that are referenced by the adopted document but missing on disk under the new folder. Priority clearly below P0.
- Spec updates for relocatable data folder (`multi-device-sync`) and attachment layout on folder change (`attachments`).
- Desktop Settings `set_data_folder` / `clear_data_folder` remain the primary surface; Android SAF keeps app-private as master — note any interaction (or lack thereof) in design; no new Settings UI without approval.

## Capabilities

### New Capabilities

- (none)

### Modified Capabilities

- `multi-device-sync`: Relocatable data folder seeding SHALL also copy this device's attachment subdirectory (not peer dirs); adopt path SHALL NOT overwrite existing blobs; P1 fill-missing may be specified as optional/deferred.
- `attachments`: Clarify that per-device attachment blobs relocate with a seeded folder change the same way history does (copy own tree only).

## Impact

- Rust: `AppState::repoint` in `src-tauri/src/store.rs`; new helper (e.g. `copy_own_attachments`) likely beside attachment helpers in `commands.rs` or a small module; unit tests parallel to `repoint_seeds_copies_own_history_sidecar`.
- Specs: `openspec/specs/multi-device-sync`, `openspec/specs/attachments`.
- No frontend API change expected (`set_data_folder` / `clear_data_folder` already call `repoint`).
- Android: SAF sync already mirrors `attachments_*`; desktop folder repoint is the gap. Confirm Settings data-folder controls are desktop-oriented and document SAF interaction in design.
- Tracking: https://github.com/puetsua/pansuthong/issues/133
