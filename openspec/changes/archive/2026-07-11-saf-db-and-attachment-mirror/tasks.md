## 1. Store adoption API for Document + content hash

- [x] 1.1 Finish `adopt_synced` / `load_replacing_local` to take `Document` and return content hash (version gate preserved)
- [x] 1.2 Export `content_hash` / `is_attachments_subdir` as needed by safsync

## 2. SAF replica push/pull (.db)

- [x] 2.1 Recognize `tasks_*.db` (and legacy `tasks_*.json`) as replicas; writable name from data path
- [x] 2.2 `push_out` writes on-disk master `.db` bytes; suppress via content hash
- [x] 2.3 `read_merged_remote` / `pull_in` / `switch_to_remote` decode `.db` via `db::load_from_bytes` (JSON fallback); adopt Document
- [x] 2.4 `remote_has_tasks` / first-link detect `.db` and JSON replicas

## 3. Attachment subdirectory mirroring

- [x] 3.1 Extend `SafBackend` path ops to support one-level `attachments_*/file` relative paths (FakeBackend + Android)
- [x] 3.2 Mirror local→remote and remote→local for subdir + legacy flat attachments

## 4. Tests and docs

- [x] 4.1 Unit tests: push/pull `.db`, mixed JSON peer, attachment subdir round-trip
- [x] 4.2 Update `sqlite-data-store` group 6 checkboxes / brief note in `docs/agent/data-model.md` or releases if needed
- [x] 4.3 Run `cargo test` for safsync/store; note live Android still needed
