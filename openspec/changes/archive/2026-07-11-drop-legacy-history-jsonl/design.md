## Context

History is an append-only JSONL sidecar beside the sync folder. Modern code already writes `history_<device>.jsonl` when the data file is `tasks_<device>.db` / `.json`, but:

- `history_path` falls back to bare `history.jsonl` for non-`tasks_*` names (e.g. legacy `tasks.json`).
- `history_replica_paths` still includes bare `history.jsonl` when present.
- `copy_own_history` copies that legacy file when seeding a new folder.

The product decision is to drop the bare sidecar entirely after a one-time migrate-into-device-file.

## Goals / Non-Goals

**Goals:**

- Never create or copy bare `history.jsonl`.
- Always write `history_<device>.jsonl` (device id from replica filename, else stable fallback aligned with `AppState` / `"device"`).
- One-time: if `history.jsonl` exists beside the data file, append its lines into this device's sidecar (respect `dedup_key` when present), then delete `history.jsonl`.
- Continue merging all peer `history_*.jsonl` files for the History view.
- Update specs and tests accordingly.

**Non-Goals:**

- Changing History UI, entry schema, or peer-merge append/dedup logic beyond ignoring bare `history.jsonl`.
- Migrating or deleting peer `history_<other>.jsonl` files.
- Touching production app data; Dev-only if runtime verification is needed.

## Decisions

1. **`history_path` never returns `history.jsonl`**
   - Derive device id via `device_id_from_data_path`; if absent (e.g. bare `tasks.json`), use the same `"device"` fallback `AppState::open` already uses (or sanitize a passed device id if we thread one). Prefer path-derived id so call sites stay `history_path(data_path)`.
   - Alternative considered: keep bare fallback for `tasks.json` — rejected; user wants no bare file.

2. **Migrate-then-delete helper**
   - Add `migrate_legacy_history_jsonl(data_path)`:
     - No-op if `history.jsonl` missing.
     - Parse lines → `filter_unseen_entries` against own sidecar → `append_history` → `fs::remove_file` on success.
     - Prefer delete over rename-aside; only keep the file if append failed.
   - Call from `AppState::open` (and at the start of `copy_own_history` on the source path) so open and folder relocate both clean legacy files.

3. **Replica discovery**
   - `history_replica_paths` lists only `history_*.jsonl` under the parent dir (sorted/deduped). Remove `legacy_history_path` from the read set (and delete the helper if unused after migrate uses a local path constant).

4. **`copy_own_history`**
   - Copy only the per-device own sidecar. Do not copy `history.jsonl`. Migrating the source first ensures legacy-only folders still seed correctly into `history_<device>.jsonl`.

5. **Tests**
   - Migrate-then-delete; `copy_own_history` does not create/copy `history.jsonl`; after migration, read does not depend on bare file; peer `history_other.jsonl` still merges; update/remove the old “copies legacy sidecar” test.

## Risks / Trade-offs

- **[Risk] Delete after partial append** → Mitigation: append via existing atomic write; only delete when migrate completes successfully; failed migrate leaves `history.jsonl` for retry on next open.
- **[Risk] Lines without `dedup_key` could duplicate if migrate ran twice** → Mitigation: delete after success; second open is a no-op.
- **[Risk] Multi-device sync folder: which device “owns” legacy lines?** → Accept: each device that opens migrates into *its* sidecar then deletes the shared bare file. First device to open wins the migrate; others already have peer history via `history_*.jsonl` if they had written before. Document in PR that next open cleans leftover `history.jsonl`.

## Migration Plan

1. Ship code that migrates on open / before copy, then never writes bare `history.jsonl`.
2. Users with leftover `history.jsonl` in a sync folder: next Dev/prod open of that folder migrates into `history_<this-device>.jsonl` and deletes the bare file.
3. Rollback: older builds that still read bare `history.jsonl` would not see migrated-only history in the device file unless they also read `history_*.jsonl` (current builds already do). Accept one-way cleanup.

## Open Questions

- None; prefer delete after successful migrate as specified.
