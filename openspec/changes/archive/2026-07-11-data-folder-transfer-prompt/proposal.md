## Why

Changing the sync/data folder today either leaves the user guessing what happens to their files, or (once `repoint-copy-attachments` lands) silently copies attachments on seed. Users need an explicit choice: keep a full copy in the old folder, or transfer this device's payload and remove it from the old location after a successful move. Without that prompt, relocating a sync folder is easy to misunderstand—especially when the old folder still holds peer replicas that must never be touched.

## What Changes

- When the user changes the data folder via desktop Settings (`set_data_folder` / `clear_data_folder`) and the operation would seed into the target **or** leave a folder that still holds this device's local payload, show a **minimal modal**: short explanation + **Copy** / **Move** / **Cancel**.
- **Copy** — transfer/seed this device's owned files into the new location and **leave originals** in the old folder (current/planned seed behavior, including DB/document seed, `history_<device>.jsonl`, and `attachments_<device>/`).
- **Move** — after a successful transfer of this device's owned payload, **remove** those files from the old folder. Never move or delete peer `tasks_<peer>.*`, `history_<peer>.jsonl`, or `attachments_<peer>/`.
- Absorb and supersede the silent-copy UX from in-progress `repoint-copy-attachments` (#133 / PR #134): attachment (and history) transfer is no longer an invisible side effect of seed; it is part of an explicit Copy vs Move choice for the whole device-owned payload.
- Adopt path (target already has replicas): dialog still applies when bringing this device's blobs/sidecars from the old folder; move still only deletes this device's files at the old location.
- **Approved Settings UI:** this modal is explicitly requested and approved for this change (AGENTS.md new-Settings-control rule). Keep it minimal—no new Settings section beyond the existing data-folder controls.
- Android SAF / relocatable-folder UI: **out of scope for v1** (desktop `set_data_folder` / `clear_data_folder` only); document interaction in design.

## Capabilities

### New Capabilities

- (none)

### Modified Capabilities

- `multi-device-sync`: Relocatable data folder SHALL prompt for Copy vs Move (or Cancel) when seeding or when leaving a folder with this device's local data; define device-owned transfer set; Copy leaves sources; Move deletes own files only after success; peers untouched; adopt and clear-to-app-data edge cases.
- `attachments`: Own attachment tree follows folder relocate under the chosen transfer mode (copy leaves source; move removes own tree from old folder after success); peers never transferred or deleted.
- `settings-and-appearance`: Desktop Settings data-folder change SHALL present the approved Copy / Move / Cancel dialog before invoking the backend transfer; Cancel leaves location unchanged.

## Impact

- Frontend: `SettingsView` / `pickAndSetDataFolder` / `clearDataFolder` flow — modal before `set_data_folder` / `clear_data_folder`; i18n strings for explanation + actions.
- Rust: `AppState::repoint` (or a thin wrapper command) gains an explicit transfer mode (`copy` | `move`); helpers to transfer then optionally remove this device's `tasks_<device>.*` / history sidecar / `attachments_<device>/` (and legacy flat blobs if still referenced); never touch peer files.
- Specs: deltas under `openspec/specs/multi-device-sync`, `attachments`, `settings-and-appearance`.
- Related work: `openspec/changes/repoint-copy-attachments` (issue #133, PR #134) — this change **supersedes** that product story; implementers should absorb any remaining P0 seed-copy work into Copy mode rather than shipping a permanent silent-copy UX. Do not fight the other agent's branch; land this proposal separately and reconcile at apply time.
- Tracking: supersedes/extends https://github.com/puetsua/pansuthong/issues/133; new issue optional for the dialog + move mode.
- Platforms: desktop v1; Android SAF unchanged in v1.
