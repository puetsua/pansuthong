## 1. Persist by path and drop the handle

- [x] 1.1 Add `persist_document` / `persist_document_within` in `src-tauri/src/db.rs` that opens, writes once, and drops the connection on every attempt; retry only lock/sharing errors until `LOCK_RETRY_BUDGET`; verify `exhausted_budget_reports_busy_not_a_raw_sqlite_error` still passes against the new path helper
- [x] 1.2 Treat `Connection::open` failures that are `SQLITE_BUSY` / `SQLITE_LOCKED` or a sharing-violation / resource-busy `io` error as contention (not generic `SQLITE_CANTOPEN`); verify a corrupt replica still fails immediately without burning the budget
- [x] 1.3 Keep `write_document(&mut Connection)` for the in-memory pending store and existing live-connection tests

## 2. File-backed AppState does not hold the replica

- [x] 2.1 Change `Inner.conn` to `Option<Connection>` (`None` between file-backed writes; `Some` only while `pending`); add a persist helper used by `write`, `reload_replicas_if_changed`, `adopt_synced`, `load_replacing_local`, `repoint`, and `open`
- [x] 2.2 After `AppState::open` and after `repoint`, drop the new connection so idle does not hold the file; verify existing store tests still compile

## 3. Tests

- [x] 3.1 Unix: after a successful `AppState` write, `/proc/self/fd` has no link to the replica path
- [x] 3.2 Windows: after persist, `OpenOptions::share_mode(0)` on the replica succeeds
- [x] 3.3 `persist_document_within` with a short budget reports `Busy`, then after the lock is released a second persist on the same path succeeds (same-session recovery, no new process)
- [x] 3.4 Switch `break_replica` to overwrite the file with non-SQLite bytes so reopen+`init` cannot undo the failure; verify the rollback / no-history / failed-merge tests still pass
- [x] 3.5 `cargo test --manifest-path src-tauri/Cargo.toml -j 1` and `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings` are clean
- [x] 3.6 `openspec validate release-replica-handle-after-lock --strict` passes

## 4. Specs

- [x] 4.1 Sync the delta into `openspec/specs/multi-device-sync/spec.md` (the three new scenarios plus the handle-release paragraph)
