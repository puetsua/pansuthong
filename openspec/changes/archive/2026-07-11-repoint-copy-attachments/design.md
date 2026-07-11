## Context

`AppState::repoint` already has two paths:

1. **Seed** (target has no task replicas / DB): clone the current document into the new folder and call `history::copy_own_history` so History stays continuous (#118).
2. **Adopt** (target already has data): merge/adopt the target document and do **not** overwrite that folder's history with the old folder's sidecar.

Attachment blobs live under `attachments_<device>/` beside the data file. Seeding copies metadata that still references those relative paths, but the blob tree is left behind — opens fail until blobs reappear via sync or re-attach. Peer dirs (`attachments_<other>/`) are intentionally left with the old folder on seed, matching peer task replicas and peer history sidecars.

Desktop Settings uses `set_data_folder` / `clear_data_folder` → `repoint`. Android's primary sync path is SAF mirroring into the app-private folder; relocatable folder UI is desktop-oriented. SAF already imports/exports `attachments_*` trees separately.

## Goals / Non-Goals

**Goals:**

- **P0:** On seed, copy this device's `attachments_<device>/` directory tree from old parent to new parent (copy, not move); leave source intact; skip peer attachment dirs.
- Failures should warn without aborting the successful document/history seed (same pattern as history copy warnings), unless a hard failure mode is clearly better — prefer warn-and-continue for parity with `copy_own_history`.
- **P1 (same change or deferred):** On adopt, never overwrite existing blobs; optionally copy only referenced paths that are missing under the new folder.
- Spec deltas for `multi-device-sync` (relocatable folder) and `attachments`.
- Unit tests parallel to existing `repoint_seeds_copies_own_history_*` / adopt-does-not-copy tests.

**Non-Goals:**

- Moving (deleting) blobs from the old folder.
- Copying peer `attachments_<other>/` on seed.
- New Settings UI or Android SAF command changes (unless a tiny doc/comment clarification).
- Changing attachment path format, GC, or merge rules beyond folder-repoint behavior.
- Overwriting blobs that already exist at the destination on adopt (P1 fills missing only).

## Decisions

1. **Mirror `copy_own_history` with `copy_own_attachments`**
   - Helper takes old/new data-file paths; resolves parents; no-op if same parent.
   - Derive this device's subdir via `config::attachments_dir_name` from the data-file device id (same source as `history_path` / `data_file_name`).
   - Recursively copy `attachments_<device>/` if it exists on the source; create destination parent as needed.
   - Do not copy other `attachments_*` directories.
   - Call from `AppState::repoint` only when `seeding` is true, beside the history copy.
   - Alternative: fold into a generic "copy own sidecars" — rejected for now; keep a focused helper next to attachment path helpers for clarity and testability.

2. **Copy vs move**
   - Always **copy**. User may still need the old folder (backup, other tools, accidental repoint). Matches history seed behavior.

3. **Error handling**
   - Prefer `eprintln!("warning: …")` and continue if document write already succeeded — same as history. Document that partial tree copy may leave some blobs missing; P0 tests cover happy path and "no source dir" no-op.

4. **P1 adopt fill-missing**
   - After adopt, walk attachment paths referenced by the adopted document; for each relative path under a managed `attachments_*` form, if missing at the new folder and present at the old folder, copy that file only (never overwrite).
   - Ship as a separate task marked P1 / optional so P0 can land alone if time-boxed.
   - Alternative: always skip adopt attachment work — acceptable deferral; gap is smaller because adopt usually means the target folder already has its blobs.

5. **Desktop vs Android**
   - Implementation lives in `repoint`, so any caller benefits. Settings data-folder picker is the desktop UX. Android SAF continues to mirror attachments independently; no change required for SAF pull/push in P0.
   - `clear_data_folder` also calls `repoint` (seed or adopt depending on default dir contents) — same helper applies.

6. **Legacy flat `attachment_*` at folder root**
   - Modern layout is `attachments_<device>/`. If legacy flat blobs still exist beside the old data file and are referenced, P0 may either (a) rely on existing `migrate_attachments_to_subdir` having already run on open, or (b) copy only the device subdir. Prefer (a): assume open-time migration already moved this device's blobs into the subdir before repoint; document that unre-migrated legacy flats are out of P0 scope unless a cheap copy of referenced flat files is trivial in P1.

## Risks / Trade-offs

- **[Risk] Large attachment trees slow folder change** → Mitigation: acceptable for desktop sync folders; copy is synchronous like today; no progress UI in P0 (no new Settings chrome).
- **[Risk] Partial copy leaves broken refs** → Mitigation: warn on error; tests for full-tree success; user can re-point or restore from old folder (source kept).
- **[Risk] P1 overwrite accidents** → Mitigation: fill-missing only; never replace existing destination files.
- **[Risk] Disk full mid-copy** → Mitigation: warn-and-continue; document that old folder remains the recovery source.

## Migration Plan

1. Ship P0 helper + `repoint` seed call + tests + spec deltas.
2. No on-disk format migration; behavior change only on next folder relocate.
3. Optionally ship P1 in the same PR or a follow-up commit/task.
4. Rollback: older builds simply stop copying attachments again; copied trees at the new folder remain valid.

## Open Questions

- Whether to implement P1 in the same apply pass or defer after P0 merges — default: include P1 as explicit tasks marked optional/deferred so apply can stop after P0 if preferred.
