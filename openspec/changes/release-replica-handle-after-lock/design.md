## Context

See proposal.md for why. `AppState` (`src-tauri/src/store.rs`) keeps a long-lived
`rusqlite::Connection` on `tasks_<device>.db` for the process lifetime. Reads already
use the in-memory `Document`; the connection is only needed to persist.

#149 added a 15s lock-retry budget and rolled back memory on failure. That is
correct for SQLite `BEGIN EXCLUSIVE` held by another connection: once that lock
drops, a later write on the same handle succeeds. It is not correct for a Windows
sync client: `CreateFile` with `share_mode` 0 fails for as long as our handle
exists, so the upload never finishes and every subsequent save burns the 15s
budget. Restart works only because it drops the handle.

The spec change is the recovery rule (release the file; same-session retry without
restart). The 15s budget, `AppError::Busy`, and in-memory rollback stay.

## Goals / Non-Goals

**Goals:**

- File-backed persists do not leave a live handle on the replica.
- Lock-contention retries close the handle between attempts.
- After `Busy`, the next persist in the same `AppState` succeeds once the lock is
  gone, without reconstructing the store.

**Non-Goals:**

- No write queue / write-behind (still the #149 non-goal).
- No change to `LOCK_RETRY_BUDGET`, journal mode, or merge rules.
- No localization of `LOCKED_MESSAGE`.
- Pending in-memory stores keep their connection.

## Decisions

**1. Persist by path for file-backed stores; drop the connection when done.**

Add `db::persist_document(path, doc)` (and `persist_document_within` for tests).
Each attempt `open`s, `write_document_once`, then drops the `Connection` — on
success, lock contention, and every other error. `AppState::Inner.conn` becomes
`Option<Connection>` and is `None` for file-backed stores between writes.

`write_document(&mut Connection)` stays for the pending in-memory store and for
tests that already drive a live connection.

*Alternative rejected:* close only after `Busy`. That recovers after the first
failure but still blocks the exclusive upload during idle, which is how the
deadlock starts.

*Alternative rejected:* raise the 15s budget. The handle would still be held for
the whole wait, so the Windows exclusive opener still cannot finish.

**2. Close between retry attempts, and treat open-time sharing failures as contention.**

On `SQLITE_BUSY` / `SQLITE_LOCKED`, drop the connection, sleep `LOCK_RETRY_PAUSE`,
reopen, retry until the existing budget. `Connection::open` itself can fail while
another process holds an exclusive Windows handle; retry that the same way when
the error is lock/sharing (`SQLITE_BUSY`/`LOCKED`, or `io` with
`ERROR_SHARING_VIOLATION` / resource-busy), not for `SQLITE_CANTOPEN` on a missing
or corrupt file.

*Alternative rejected:* retry `SQLITE_CANTOPEN` unconditionally. A directory
standing in for the replica, or a missing path, would burn the full budget.

**3. One persist helper on `AppState`.**

`write`, `reload_replicas_if_changed`, `adopt_synced`, `load_replacing_local`,
`repoint`, and the initial open all persist through the same helper so handle
release cannot be skipped on one path. `repoint` must not keep the new
connection either.

**4. Tests prove handle release without a 15s sleep.**

- Unix: after a successful `AppState` persist, `/proc/self/fd` has no entry for
  the replica path.
- Windows: after persist, `OpenOptions::share_mode(0)` on the replica succeeds
  (`std::os::windows::fs::OpenOptionsExt`; no extra crate).
- `persist_document_within` with a short budget: Busy, then lock released, then
  a second persist on the same path succeeds (same-session recovery).
- Existing `break_replica` tests must still fail without retrying. Overwrite the
  file with non-SQLite bytes so reopen+`init` cannot resurrect a dropped table.

## Risks / Trade-offs

- **Open/close per write is slower than a long-lived connection** → Writes are
  user-driven and already do a full rewrite inside a transaction; open/pragma
  cost is small next to that. Correctness on a cloud-synced path wins.
- **A persist can race a sync-client exclusive open** → Same as today, now
  recoverable: we retry for 15s with the handle dropped between attempts, then
  fail cleanly, then the next click works.
- **`CREATE TABLE IF NOT EXISTS` on every `open` would undo a `DROP TABLE` test
  injection** → Use a corrupt-file injection for non-lock failures instead of
  dropping a table through a second connection.
- **Windows `share_mode(0)` test does not run on Ubuntu CI** → The `/proc/self/fd`
  assertion covers the same contract on Linux; keep the Windows test for local
  and any future Windows CI.

## Migration Plan

None. Behavioral only; revert to restore the long-lived connection.

## Open Questions

None.
