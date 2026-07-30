## 1. Distinguish lock contention from other database errors

- [x] 1.1 Add an `AppError::Busy(String)` variant in `src-tauri/src/error.rs` with a `Display` message naming the likely cause (sync client holding the data file) and stating the change was not saved
- [x] 1.2 Add a helper that recognizes `SQLITE_BUSY` / `SQLITE_LOCKED` (including extended codes) on a `rusqlite::Error`

## 2. Retry the write within a bounded budget

- [x] 2.1 Add a named retry-budget constant in `src-tauri/src/db.rs` alongside `BUSY_TIMEOUT`, documenting the 6s-succeeds / 12s-fails measurement it is sized against
- [x] 2.2 Wrap the `write_document` call path in a bounded retry that re-attempts only on lock errors and returns `AppError::Busy` when the budget is exhausted
- [x] 2.3 Confirm a non-lock error returns immediately and does not consume the budget

## 3. Make a failed write atomic in memory

- [x] 3.1 In `AppState::write`, restore `g.doc = before` when `write_document` fails, so the in-memory document (including `last_modified` and `version`) matches disk
- [x] 3.2 Confirm `append_history` still runs only after a successful write — no history for a change that did not persist
- [x] 3.3 In `reload_replicas_if_changed`, leave `inner.doc` at the pre-merge document and leave `peers_hash` un-refreshed when the merged write fails, so a later poll retries the merge

## 4. Verify

- [x] 4.1 Make `write_survives_a_transient_external_lock` in `src-tauri/src/store.rs` pass with the external lock held past `BUSY_TIMEOUT` but inside the retry budget
- [x] 4.2 Cover budget exhaustion and rollback without a second multi-second sleep: assert `AppError::Busy` in `db.rs` with an injected short budget (`write_document_within`) and a lowered `busy_timeout`, and assert the in-memory rollback in `store.rs` by forcing a non-lock write failure instead of waiting out the real budget
- [x] 4.3 Add a test asserting no history entry is appended for a write that failed
- [x] 4.4 Add a test asserting a failed peer re-merge leaves the pre-merge document in place
- [x] 4.5 Run `cargo test --manifest-path src-tauri/Cargo.toml -j 1` and `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings` clean
