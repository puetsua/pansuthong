## Why

After #149 / PR #151, a write that loses to an external lock for more than 15s
fails cleanly and rolls back memory — but production Windows still cannot recover
in the same session (#179). The long-lived SQLite handle on `tasks_<device>.db`
blocks the cloud-sync client's exclusive upload open (`CreateFile` with
`share_mode` 0). Retrying the same connection does nothing until the app restarts
and drops that handle. Restart must not be part of the recovery story.

## What Changes

- File-backed replica writes no longer keep a live SQLite connection on the
  cloud-synced path between operations. After each persist (success or
  lock-contention failure) the handle is closed so another process can
  exclusive-open the file.
- A write that hits lock contention closes the handle between retry attempts, so
  a waiting sync-client upload can finish inside the existing 15s budget.
- After a `Busy` failure, the next user action in the same session reopens the
  replica and persists once the lock is gone — no restart.
- In-memory pending stores (cloud folder not mounted yet) still keep a live
  connection; they have no file to contend over.
- No write queue, no change to the retry budget, storage format, merge rules, or
  replica layout.

## Capabilities

### New Capabilities

<!-- none -->

### Modified Capabilities

- `multi-device-sync`: the "Durable writes under external lock contention"
  requirement already covers bounded retry and in-memory/disk atomicity. It does
  not say that a failed (or finished) write must release the replica file, or
  that a later write in the same session must succeed without restarting. Those
  recovery rules are added.

## Impact

- `src-tauri/src/db.rs` — persist-by-path that opens, writes, and drops the
  connection; retry loop closes the handle between attempts; open-time sharing
  violations retry as contention.
- `src-tauri/src/store.rs` — file-backed `AppState` does not keep `Connection`
  between writes; all persist paths (`write`, peer re-merge, SAF adopt, data-
  source switch, `repoint`, initial open) go through the same helper.
- Tests in `db.rs` and `store.rs` for handle release and same-session recovery.
- No frontend, schema, locale, or Settings changes.
