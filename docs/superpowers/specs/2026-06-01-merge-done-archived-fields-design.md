# Merge `done`, `archived`, `archived_at` into a single `completed_at`

**Date:** 2026-06-01
**Status:** Approved (Approach A)

## Problem

A `Task` (`src-tauri/src/model.rs`, mirrored in `src/lib/tauri.ts`) carries four
fields that the current model keeps perfectly redundant:

- `done: bool`
- `completed_at: Option<i64>`
- `archived: bool`
- `archived_at: Option<i64>`

`Task::set_done` keeps `done` ↔ `archived` and `completed_at` ↔ `archived_at` in
lockstep: finishing a task immediately archives it, reopening it un-archives it.
So `archived == done` and `archived_at == completed_at` for all data the app
produces.

Two vestiges assume a `done && !archived` state that `set_done` never creates:
the `archive_completed` Tauri command and the ArchivedView "Archive N completed"
button (#23). They are effectively dead code for current data.

## Decision

Collapse to a **single source of truth: `completed_at: Option<i64>`**.
`Some(ts)` = the task is done **and** archived at `ts`; `None` = active.
`done`, `archived`, `archived_at` become *derived*, not stored. Remove
`archive_completed` and its UI entirely.

This was chosen over keeping a stored `done` boolean (the user explicitly wants
the single-timestamp shape) and over a minimal "remove fields, ignore unknown
keys" change (rejected: it crashes older app builds on the now-missing required
`done` key and risks un-completing pre-`completed_at` legacy tasks).

## On-disk / wire result

The Rust `Task` is serialized identically to the disk file (`tasks.json`) and to
the frontend wire payload (`DocumentView` clones `Vec<Task>`), so this one change
covers both.

- Completed task: `{ …, "completed_at": 1748390000000 }` — no `done`,
  `archived`, or `archived_at` keys.
- Active task: no `completed_at` key at all (`skip_serializing_if = "Option::is_none"`).

## Design

### Rust — `src-tauri/src/model.rs`

- `Task` drops `done`, `archived`, `archived_at`; keeps
  `#[serde(skip_serializing_if = "Option::is_none", default)] completed_at: Option<i64>`.
- Derived accessors (inherent methods):
  - `fn done(&self) -> bool { self.completed_at.is_some() }`
  - `fn archived(&self) -> bool { self.completed_at.is_some() }`
  - `fn archived_at(&self) -> Option<i64> { self.completed_at }`
- `set_done(&mut self, done: bool, ts: i64)` becomes
  `self.completed_at = if done { Some(ts) } else { None };` plus the existing
  `self.updated_at = ts;`.
- View filters switch field access to method calls: `tasks_today`,
  `tasks_inbox`, `tasks_for_tag` use `t.archived()` / `t.done()`.
- **Backward-compat shim.** `Task` gets `#[serde(from = "TaskCompat")]` where
  `TaskCompat` is a private `Deserialize` struct holding the full legacy field
  set (`done`, `archived`, `archived_at`, `completed_at`, all
  `#[serde(default)]`). `From<TaskCompat> for Task` reconstructs:

  ```rust
  let completed_at = c.completed_at.or_else(|| {
      if c.done || c.archived { c.archived_at.or(Some(0)) } else { None }
  });
  ```

  `completed_at` wins when present; otherwise a legacy done/archived task is
  preserved as completed (using `archived_at`, or epoch `0` as a
  "done, time unknown" sentinel). Serialize is unaffected — it emits only the
  real `Task` fields.
- `CURRENT_VERSION` bumped `2 → 3`.

### Rust — `src-tauri/src/store.rs`

- `write()` stamps `g.doc.version = CURRENT_VERSION;` alongside the existing
  `last_modified` bump, so any save upgrades the file to v3. The existing
  `parse_checked` guard (`doc.version > CURRENT_VERSION` → error) then makes an
  *older* app build refuse a v3 file cleanly instead of crashing on the missing
  `done` key. `adopt_synced` writes verbatim bytes from another (already-v3)
  device and is unchanged.
- Update test struct literals to drop the removed fields.

### Rust — `src-tauri/src/conflict.rs`

- `task_equal` compares `a.done() == b.done()` and `a.archived() == b.archived()`
  (both now reduce to comparing `completed_at`, but keep them readable).
- Update test struct literals.

### Rust — `src-tauri/src/commands.rs` and `src-tauri/src/lib.rs`

- Delete the `archive_completed` command.
- Remove its entry from the `tauri::generate_handler![…]` list in `lib.rs`.
- Remove any matching `capabilities/default.json` permission entry if present.
- Update the `make_task`/struct-literal helper(s).

### Frontend — `src/lib/tauri.ts`

- `Task` type drops `done`, `archived`, `archived_at`; keeps
  `completed_at?: number`.
- Add helpers `isDone(t: Task): boolean` and `isArchived(t: Task): boolean`,
  both `t.completed_at != null`.
- Remove the `archiveCompleted` binding from `api`.

### Frontend — consumers

- `src/state/indexes.ts`: `t.done` → `isDone(t)`, `t.archived` → `isArchived(t)`;
  the archived sort keys on `completed_at` only.
- `src/components/TaskRow.tsx`: checkbox/`data-done`/late-badge use `isDone(task)`;
  the template-draft spread and optimistic block drop the removed fields
  (`completed_at: undefined` suffices). The `restore` comment about the
  "done↔archived coupling" is updated.
- `src/views/TagView.tsx`: open count uses `isDone`.
- `src/views/ConflictsView.tsx`: the "✓ done" badge uses `isDone(task)`.
- `src/views/ArchivedView.tsx`: remove the "Archive N completed" button and the
  `completedActive` count; keep the archived list + Restore.

### Fixtures & tests

- Update `src/tests/fixtures/sample.json` and `src-tauri/tests/fixtures/sample.json`
  to the new shape.
- Update affected `.test.ts(x)` and `src-tauri/tests/*.rs` expectations.
- Add a Rust test that deserializes a **legacy** task JSON
  (`{ "done": true, "archived": true, "archived_at": 123, … }` with no
  `completed_at`) and asserts it loads with `completed_at == Some(123)` and
  `done() == true`. Add a second case: legacy `done:true` with neither
  `completed_at` nor `archived_at` → `completed_at == Some(0)`.

## Out of scope

- No change to tags, priority, templates, or sync transport.
- No data-file rewrite-on-load migration pass; the serde `from` shim migrates
  lazily and the next `write()` persists the v3 shape.

## Risks

- An older app build pointed at a synced folder that a v3 device has written to
  will now refuse the file with the existing "update the app" error. This is the
  intended, safe failure (vs. a crash) and matches the #44 version guard.
