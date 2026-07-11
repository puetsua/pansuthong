## Context

Desktop already persists `tasks_<device>.db` (single-file DELETE journal) and merges peer `.db`/legacy JSON replicas. Android SAF (`safsync.rs`) still serializes JSON for push/pull and only lists top-level files for attachments, so it cannot interoperate with a desktop-seeded Drive folder. Attachment blobs on both platforms now live under `attachments_<device>/`.

## Goals / Non-Goals

**Goals:**

- Push this device's `.db` into the SAF folder; pull/merge remote `.db` (and legacy JSON) via `merge_documents`
- Use document content-hash for `last_synced_hash` (align with desktop `store`)
- Mirror `attachments_<device>/attachment_*` both ways; keep legacy flat `attachment_*`
- Keep conflict JSON copies and delete-on-resolve behavior
- Unit-test via `SafBackend` fake (no device required for CI)

**Non-Goals:**

- Attachment tombstones / cross-device delete GC (#121/#123)
- History merge semantics or moving history into SQLite (#124/#126)
- Changing desktop Drive sync
- Live Android QA in this change (note as follow-up)

## Decisions

### D1: Push the on-disk master `.db` bytes; hash the Document

With D3a (single-file store, no WAL at rest), the file at `AppState::path()` is the publishable replica. Push reads those bytes after the store is consistent. Change detection continues to use `content_hash(Document)`, not SHA of DB bytes (SQLite files are not byte-stable for identical content).

**Alternative considered:** `VACUUM INTO` temp then push — safer if WAL ever returns, but unnecessary under DELETE journal and adds SAF write cost.

### D2: `adopt_synced` / `load_replacing_local` take `Document`

Decode replicas in safsync (`db::load_from_bytes` for `.db`, serde for JSON), then hand the Document to the store. Avoids double-parsing and matches content-hash bookkeeping.

### D3: Relative paths with `/` on `SafBackend`

Extend `list_file_names` / `read_file` / `write_file` / `delete_file` so names may be `attachments_<seg>/<file>`. FakeBackend keys the same way. Android backend: list top-level files plus one level of `attachments_*` dirs; create the subdir on write if missing.

**Alternative considered:** Flatten names for SAF only — rejected (diverges from desktop paths stored in Document metadata).

### D4: Legacy JSON peers remain readable

`is_replica_filename` accepts `tasks_*.db` and `tasks_*.json`. Prefer `.db` when both exist for the same device stem. Empty-folder seed still writes `.db` named from `data_path`.

### D5: Conflict copies stay JSON

Unchanged: conflict files remain `*.json` with "conflict" in the name so existing conflict UI/scan keep working.

## Risks / Trade-offs

- [Android SAF providers differ on nested dirs] → One-level recursion only; treat missing subdir create as error surfaced in `last_error`; FakeBackend covers logic
- [Mid-sync torn `.db`] → `db::load_from_bytes` + `quick_check`; skip bad replica like desktop
- [Mixed JSON+DB folders during rollout] → Read both; push only `.db` from this app going forward
- [Live device untested here] → Document in PR; group 6 originally deferred for this reason

## Migration Plan

1. Ship Android build that speaks `.db`
2. Existing SAF folders with only JSON: pull still works; next push adds `tasks_<device>.db`
3. Desktop peers already on `.db` become visible to phone after first successful pull
4. Rollback: older Android builds ignore `.db` and keep using JSON if present — leave legacy JSON in place only if we still write it (we will **not** dual-write; older Android must update). Accept brief one-way break for un-updated phones.

## Open Questions

- None blocking implementation. Live PC↔Android round-trip remains a manual verification item.
