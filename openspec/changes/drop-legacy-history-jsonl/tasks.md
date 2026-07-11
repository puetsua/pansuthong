## 1. History path and migration

- [x] 1.1 Change `history_path` to always return `history_<device>.jsonl` (device from data path, else stable `"device"` fallback); never bare `history.jsonl`
- [x] 1.2 Add `migrate_legacy_history_jsonl`: append parseable legacy lines into own sidecar with dedup, then delete `history.jsonl` on success
- [x] 1.3 Stop including bare `history.jsonl` in `history_replica_paths`; remove unused `legacy_history_path` helper if obsolete
- [x] 1.4 Update `copy_own_history` to migrate source first and copy only the per-device sidecar (no `history.jsonl` copy)

## 2. Store wiring

- [x] 2.1 Call migrate from `AppState::open` (and ensure repoint/seed path benefits via `copy_own_history` migrate)

## 3. Specs and tests

- [x] 3.1 Sync main specs wording if needed for archive-and-history / multi-device-sync (delta already in change)
- [x] 3.2 Tests: migrate-then-delete; copy_own_history does not copy `history.jsonl`; read ignores bare file after migration; peer `history_other.jsonl` still read; non-`tasks_*` write uses device fallback
- [x] 3.3 Run `cargo test` for history/store coverage and fix failures
