## Context

Desktop Settings already lets the user change the sync/data folder via `pickAndSetDataFolder` → `set_data_folder` and `clearDataFolder` → `clear_data_folder`. Both call `AppState::repoint`, which either **seeds** an empty target (clone current document + `copy_own_history`) or **adopts** an existing folder's replicas (merge target; do not overwrite that folder's history with the old sidecar). Attachment blobs under `attachments_<device>/` are not copied on main today.

In-progress change `repoint-copy-attachments` (issue #133, PR #134) proposes **silent copy** of `attachments_<device>/` on seed only—mirroring history, leave source intact, no new UI. That closes the broken-open gap but still leaves users without a clear story for “did my data stay in the old folder?” and offers no **move** path.

This change replaces that silent-copy product story with an explicit **Copy / Move / Cancel** dialog whenever folder change would seed or leave a folder that still holds this device's local payload. Copy mode absorbs the P0 attachment (and history) transfer work from `repoint-copy-attachments`; Move adds post-success cleanup of **own** files only.

Settings/data-folder config remain device-local. Peer replicas and peer sidecars in a shared sync folder must never be moved or deleted by this device.

## Goals / Non-Goals

**Goals:**

- Always show a minimal dialog (explanation + Copy / Move / Cancel) on desktop `set_data_folder` / `clear_data_folder` when seeding **or** when leaving a folder that still has this device's local data (DB/replica, history sidecar, and/or attachment tree).
- **Copy:** place this device's owned payload at the new location; leave originals in the old folder.
- **Move:** after successful transfer, remove this device's owned files from the old folder only.
- Device-owned set: `tasks_<device>.db` (and legacy `tasks_<device>.json` if present as this device's file), `history_<device>.jsonl`, `attachments_<device>/`, plus legacy flat `attachment_*` at folder root only if still referenced and not yet migrated.
- Never transfer or delete peer `tasks_<peer>.*`, `history_<peer>.jsonl`, `attachments_<peer>/`.
- Absorb remaining `repoint-copy-attachments` work into Copy mode; supersede silent-copy UX.
- Approved Settings modal (user-requested); keep chrome minimal.

**Non-Goals:**

- Android SAF relocatable-folder UI / SAF pick-folder transfer prompt (v1 desktop only).
- Moving or deleting peer device files, conflict files owned by peers, or unrelated user files in the folder.
- Progress UI for large attachment trees (acceptable sync copy; warn on failure).
- Changing Document merge rules, attachment GC, or path format beyond relocate transfer.
- Fighting or rewriting the other agent's `openspec/repoint-copy-attachments` branch; reconcile at apply/merge time.

## Decisions

1. **Relation to `repoint-copy-attachments` — supersede silent copy with dialog + modes**
   - Product story: **always prompt** when the relocate would seed or leave local own-data behind; user chooses Copy or Move (or Cancel).
   - Implementation: treat Copy mode as the home for P0 seed transfer of history + attachments (and document seed already in `repoint`). If #133 / PR #134 has already landed a `copy_own_attachments` helper, reuse it inside Copy/Move transfer rather than duplicating. If that change is still open, absorb its remaining tasks into this change's apply and close/supersede the silent-copy-only UX in specs.
   - Alternative considered: depend on `repoint-copy-attachments` shipping first, then add UI later — rejected; that would ship a permanent silent-copy behavior users cannot opt out of toward Move, and two UX stories in sequence.
   - Alternative considered: keep silent copy and only add Move behind a separate toggle — rejected; user asked for an explicit popup explaining both options.

2. **When to show the dialog**
   - Show when either:
     - Target will be **seeded** (no task replicas / DB at destination), **or**
     - Old folder still contains any of this device's owned payload files/dirs (even on adopt, if own history/attachments would be left behind or need bringing).
   - Skip only when there is nothing to transfer and nothing to leave behind (e.g. same-parent no-op, or both folders already share the same parent with no distinct own payload to act on). Prefer showing over skipping when unsure.
   - **Cancel:** do not call `set_data_folder` / `clear_data_folder`; location unchanged.
   - Alternative: show only on seed — rejected; adopt + clear-to-app-data also need an explicit leave-behind vs transfer story.

3. **Device-owned transfer set**
   - Always scoped to **this** `device_id`:
     - Primary replica: `tasks_<device>.db` (legacy `tasks_<device>.json` only if it is this device's file and still present).
     - `history_<device>.jsonl` (after any on-source legacy `history.jsonl` → own sidecar migration already used by `copy_own_history`).
     - `attachments_<device>/` tree.
     - Legacy flat root `attachment_*` only if still referenced and migration has not already moved them into the subdir (prefer open-time migration; cheap referenced-flat copy/move only if needed).
   - **Peers:** never copy, move, or delete.
   - **Conflict files:** do not move/delete peer or ambiguous conflict copies in v1; document as non-goal unless clearly this-device-only and cheap—default leave them.

4. **Seed vs adopt vs clear**
   - **Seed (empty target):** Copy/Move both write the seeded document at the new path, copy own history + own attachments into the new folder. Move then deletes own payload from the old folder after success.
   - **Adopt (target has replicas):** Document comes from the target (existing `repoint` adopt). Dialog Copy may still copy missing own history/attachments from the old folder into the new folder when needed so this device's continuity/blobs are available (fill-missing for attachments; do not overwrite existing target blobs). Move after success still only removes own files from the **old** folder—never peer files at either location, never overwrite target blobs.
   - **`clear_data_folder` (back to app-data):** same dialog + modes; target is the default app-data dir (seed or adopt depending on contents). Move cleans the previous custom folder's own files only.

5. **API shape**
   - Extend `set_data_folder` / `clear_data_folder` (or a single internal `repoint` path) with `transfer_mode: "copy" | "move"`. Frontend shows dialog, then invokes with the chosen mode.
   - Prefer frontend-owned dialog (in-app modal, not `window.confirm`—WebView2 confirm is unreliable; match TaskEditor / ThemeEditor patterns) so Copy and Move are first-class actions, not a yes/no confirm.
   - Alternative: backend-only prompt — rejected; Tauri commands should stay non-interactive.

6. **Move safety**
   - Order: complete successful write/copy of own payload to the new location **first**; only then delete own files from the old folder.
   - If transfer partially fails: do **not** delete sources; warn/surface error; prefer leaving old folder intact (recovery source).
   - Deleting own replica from old folder after Move is intentional: that folder may still hold peer replicas for multi-device sync; this device simply no longer leaves its replica there.

7. **Desktop vs Android**
   - v1: desktop Settings data-folder picker / clear only.
   - Android SAF remains app-private master + mirror; no transfer dialog on SAF pick/unlink in v1. Note in tasks as follow-up if product wants parity later.

8. **Settings UI approval**
   - New modal is explicitly approved by this change request. No new Settings *section*—only a dialog on the existing data-folder actions.

## Risks / Trade-offs

- **[Risk] Move deletes user's only backup of own files in the old sync folder** → Mitigation: dialog copy explains both options; Copy is a safe default focus if we pick one primary button; Move is explicit second action; Cancel aborts.
- **[Risk] Large attachment trees make folder change slow** → Mitigation: acceptable for desktop; no progress UI in v1; warn on failure; Move only deletes after success.
- **[Risk] Partial copy then Move would be catastrophic** → Mitigation: Move cleanup runs only after successful transfer of the owned set; on any hard failure, skip cleanup.
- **[Risk] Dual open changes (`repoint-copy-attachments` vs this)** → Mitigation: separate branch/worktree from main; design supersedes silent-copy UX; at apply time reuse helpers if present; update/close #133 when this lands.
- **[Risk] Adopt + Move confuses users (“I moved but the new folder already had data”)** → Mitigation: dialog explanation distinguishes bringing own sidecars/blobs vs adopting the target document; never delete peer or target-owned files.
- **[Risk] Legacy flat attachments / legacy JSON replica edge cases** → Mitigation: prefer existing migration paths; document cheap own-only handling; peers untouched.

## Migration Plan

1. Land OpenSpec artifacts (this change); optionally file a tracking issue linking #133 as superseded-in-part.
2. On apply: implement transfer mode + dialog; absorb attachment seed copy into Copy; add Move cleanup; tests for seed/adopt/clear × copy/move; peers untouched.
3. If `repoint-copy-attachments` merged first: thin-wrap its helper and replace silent-only behavior with dialog-gated modes in a follow-up commit on apply.
4. If that change is still open: prefer implementing once under this change and closing the silent-copy-only proposal as superseded.
5. Rollback: older builds ignore transfer_mode if we default missing arg to copy-compatible behavior; moved-away old folders are not automatically restored.

## Open Questions

- Default focused button: **Copy** (safer) vs **Move** — recommend Copy as primary/safe default; Move as secondary.
- Whether adopt should offer Move when the only “transfer” is deleting own leftovers from the old folder (no seed). **Yes** — still show dialog when old folder has own payload; Copy = leave old own files; Move = remove old own files after any needed fill-missing copy.
- Android parity for SAF — deferred; confirm out of scope for v1 (assumed yes).
