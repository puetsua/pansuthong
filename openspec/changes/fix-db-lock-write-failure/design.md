## Context

`AppState::write` (`src-tauri/src/store.rs:107-127`) does this, in order:

```rust
let before = g.doc.clone();          // captured for history diffing
let value = f(&mut g.doc)?;          // in-memory mutation, already applied
g.doc.last_modified = ts;
crate::db::write_document(&mut inner.conn, &inner.doc)?;   // <-- can fail
crate::history::append_history(...)  // only on success (already correct)
```

The `?` on `write_document` returns while `g.doc` still holds the mutation. `before`
exists a few lines up and is exactly what should be restored, but never is. So after a
`database is locked` failure the store reports a document that is not on disk: the
frontend re-reads it via `get_document` and renders a completion that was never
persisted, and the next successful write bakes it in.

`reload_replicas_if_changed` (lines 132-172) has the same shape — it assigns
`inner.doc = merged` before `write_document` — with the same exposure.

The 5s `BUSY_TIMEOUT` (`src-tauri/src/db.rs:29`) is documented as covering "transient
Drive/OneDrive contention". Measured against the reproduction: a 6s external lock is
ridden out, a 12s one fails. Real sync clients hold locks well past 6s.

Note this is a *different* cause from the already-fixed `is_own_replica` bug
(`store.rs:453-463`), which produced the same message by opening our own replica as a
peer. That path is closed; this is genuine third-party contention.

## Goals / Non-Goals

**Goals:**

- Ordinary sync-client contention never reaches the user.
- A write either happens everywhere or nowhere — in-memory and on-disk never disagree.
- When a write does fail, the message says what happened and that the edit was not
  saved.

**Non-Goals:**

- No queue, journal, or deferred write-behind for edits that fail. That is a much
  larger design (ordering, durability across restart, conflict interaction with the
  peer merge) and the honest failure this change delivers is the prerequisite for it.
- No change to the storage format, merge rules, journal mode, or replica layout.
- No localization of the error message (needs an error-code channel; separate change).
- No change to Android SAF sync, which exchanges whole files rather than writing
  through this connection.

## Decisions

**1. Roll back `g.doc` to `before` when persistence fails.**

This is the core correctness fix and is nearly free — the clone already exists for
history diffing. Restoring the whole document also restores `last_modified` and
`version`, so no field-by-field undo is needed.

The rollback must cover the mutation closure's effect only. `append_history` already
runs after the successful write, so a failed write records no history — that part
needs no change, only a test to pin it.

`reload_replicas_if_changed` gets the same treatment: on persist failure, leave
`inner.doc` at the pre-merge document and leave `peers_hash` un-refreshed, so the next
poll sees the peer as still-changed and retries the merge naturally.

*Alternative rejected:* persist first, then mutate memory. The mutation closure is what
*produces* the document to persist, so it cannot run after. Restoring on failure is the
only ordering available.

**2. Bounded application-level retry for lock errors only, on top of the existing
busy timeout.**

`busy_timeout` is SQLite's own inner wait; an outer loop adds two things it cannot:
the ability to distinguish `SQLITE_BUSY`/`SQLITE_LOCKED` from every other failure, and
a budget expressed in our terms rather than as a pragma. Retry only on those two
codes — retrying a constraint violation or a corrupt-database error would just delay
an inevitable failure.

The total budget is the trade-off between riding out a sync upload and freezing the
UI. Roughly 15s of wall clock is chosen: comfortably past the observed 6s-succeeds /
12s-fails boundary, and short enough that a stuck lock reports back within a
sensible interaction timeout rather than appearing to hang. Backoff is coarse
(a short fixed sleep between attempts) — this is contention with a foreign process on
a timescale of seconds, so exponential backoff buys nothing.

The budget lives in a named constant so the reproduction test can hold a lock past
the bare `BUSY_TIMEOUT` but inside the budget and assert success, without the test
depending on wall-clock luck.

*Alternative rejected:* simply raising `BUSY_TIMEOUT` to 15s. It is fewer lines, but it
applies the long wait to *every* SQLite operation including reads and startup, and it
still cannot tell a lock apart from any other error for the purpose of messaging.

**3. A distinct `AppError::Busy` variant.**

`AppError::Db` stringifies rusqlite verbatim, which is how `database is locked` reached
the toast. `Busy` carries a written message — that the data file is temporarily locked,
likely by the sync client, and that the change was not saved. It reaches the UI through
the existing `errorMessage` path with no frontend change.

Keeping it a separate variant (rather than rewording `Db`) also lets the retry loop and
any future queueing match on it.

## Risks / Trade-offs

- **A 15s budget means a genuinely stuck lock blocks the command for 15s** → The
  command already blocked for 5s before failing; this trades a longer worst case for
  removing the common failure entirely. The failure is now non-destructive, so the
  user's recourse — click again — actually works.

- **Holding the store `Mutex` across the retry serializes other commands behind it** →
  Already true today for the 5s busy wait, so this widens an existing window rather
  than opening a new one. Widening it is acceptable because the alternative is losing
  the edit; narrowing it properly means moving persistence off the lock, which belongs
  with the queueing work listed as a non-goal.

- **Rollback discards the user's edit on final failure** → Intended, and it is the
  honest outcome: the UI reverting the checkbox is the signal that the edit did not
  land. Silently keeping it in memory is the bug being fixed.

- **The reproduction test sleeps for seconds of real time** → It is one test, gated on
  the named budget constant so the timings stay legible and adjustable together.

## Migration Plan

None. No persisted data, format, or setting changes; the fix is behavioral and a
rollback is a straight revert.

## Open Questions

None.
