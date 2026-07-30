## Why

When a cloud-sync client holds a write lock on `tasks_<device>.db` for more than the
5s SQLite busy timeout, completing a task fails with a raw `database is locked` toast
(#149). Two things are wrong. The wait is too short — sync clients routinely hold a
lock longer than 5s while uploading — and, more seriously, the failure is not clean:
`AppState::write` mutates the in-memory document *before* persisting it and never
restores it when the persist fails, so the app keeps showing a completion that was
never written. The next successful write then persists that phantom state. A task
tracker that reports success for an edit it silently dropped, or drops an edit it
appears to have kept, is failing at its one durability promise.

## What Changes

- A write that loses the race against a transient external lock is retried within a
  bounded budget instead of failing at the first timeout, so ordinary sync-client
  contention no longer reaches the user at all.
- A write that ultimately cannot be persisted leaves the in-memory document exactly as
  it was before the mutation. The UI reverts to the last durable state rather than
  showing an edit that only exists in memory, and no history entry is recorded for a
  change that did not happen.
- Lock contention is reported as its own error kind with an actionable message, instead
  of leaking the rusqlite string `database is locked` into a toast.
- No change to the storage format, the merge rules, or the replica layout.

## Capabilities

### New Capabilities

None. This closes a durability gap in an existing capability.

### Modified Capabilities

- `multi-device-sync`: the "Per-device replicas" area specifies *what* this device
  writes but says nothing about what happens when that write cannot proceed because
  another process holds the file. A requirement is added covering contention: bounded
  retry, and an atomic outcome where the in-memory document and the replica on disk
  never disagree.

## Impact

- `src-tauri/src/store.rs` — `AppState::write` (lines 107-127): add rollback of `g.doc`
  on persist failure; `before` is already captured for history diffing and can serve
  both roles. `reload_replicas_if_changed` (lines 132-172) has the same shape and needs
  the same treatment for its merged assignment.
- `src-tauri/src/db.rs` — `BUSY_TIMEOUT` (line 29) and the write path gain a bounded
  retry for `SQLITE_BUSY` / `SQLITE_LOCKED`.
- `src-tauri/src/error.rs` — a `Busy` variant distinct from the general `Db` variant.
- Tests: `src-tauri/src/store.rs` (`write_survives_a_transient_external_lock`, already
  written and failing at a 12s hold), plus new coverage for the rollback path.
- No frontend changes required; the clearer message arrives through the existing
  `errorMessage` path. Localizing that message is out of scope — it would need an error
  *code* channel rather than a display string, which is a separate change.
- No model, schema, or locale changes. No migration.
