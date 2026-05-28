# Pansutong Phase 2-Sync — Watcher + Conflict UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make multi-device file sync via Syncthing actually work. When another device pushes a new `tasks.json`, this app picks it up instantly (no restart). When Syncthing flags a real conflict, the user sees a banner and resolves it through a per-task diff UI.

**Architecture:** A background watcher in Rust (`notify` crate) watches the data file's parent directory. On every event, sha256 the file: if it matches the last write we made, ignore (own-write echo); otherwise reload state and emit `store-changed`. Same path scans for sibling `*conflict*.json` files and emits `conflicts-detected` with the list. Conflict resolution reads both documents in memory, presents a per-task diff, applies the user's choices, writes the merged result, and deletes the conflict file.

**Tech Stack additions:**
- `notify` v6 (Rust) — cross-platform filesystem events. **NEW dep.**
- No new TS deps.

**Prerequisites:**
- Phase 2 (views + smart-parse) merged into `main`.
- `npm run tauri dev` launches a working desktop app with the dense Today view.
- For interactive smoke testing: **Syncthing for Windows** installed, with one folder configured at `%APPDATA%\net.puetsua.pansutong\` shared with at least one other device or test endpoint. (Not strictly required to ship — the watcher and conflict-file scanner are unit-testable via planted files.)

---

## Scope and non-goals

This plan covers Section 3 of the design spec EXCEPT for:
- **The data-file path picker UI.** This plan keeps the data file at `app_data_dir/tasks.json` (the default). Users sync that folder via Syncthing's own configuration. Picking a different folder from inside the app is **deferred to a later phase** because it requires re-opening `AppState` mid-process and a clean restart story.
- **Android-side polling.** Section 3's Android handling (SAF + poll-every-3s) is part of `pansutong-phase-4-android.md`. This plan targets desktop only.

All other Section 3 content lands here:
- Atomic write loop-suppression (already in `store.rs` from Phase 1 — verify and wire up).
- Filesystem watcher with debounce.
- External-change reload path.
- Conflict-file detection + banner.
- Conflict-resolve UI.

---

## Files this plan creates or modifies

### Rust (under `src-tauri/`)

| Path | Action | Responsibility |
|---|---|---|
| `Cargo.toml` | Modify | Add `notify = "6"` |
| `src/sync.rs` | Create | Watcher start/stop, debounce, hash suppression, conflict scan, event emitter |
| `src/conflict.rs` | Create | Pure diff/merge logic: compare two `Document`s, produce `TaskDiff` list, apply decisions |
| `src/commands.rs` | Modify | Add `list_conflicts`, `read_conflict`, `resolve_conflict`, `dismiss_conflict` |
| `src/lib.rs` | Modify | Start watcher in setup hook; register new commands |
| `src/store.rs` | Modify | Add `swap_document` for the reload path; expose `data_path()` |
| `tests/sync_integration.rs` | Create | Integration tests for watcher loop-suppression + conflict scan |
| `tests/conflict_unit.rs` | Create | Pure tests on conflict.rs diff/merge |

### Frontend (under `src/`)

| Path | Action | Responsibility |
|---|---|---|
| `lib/tauri.ts` | Modify | Wrappers for the 4 new commands + `ConflictFile`/`ConflictDiff`/`Decision` types |
| `state/conflicts.ts` | Create | `useConflicts` hook (subscribes to `conflicts-detected`) |
| `state/store.ts` | Modify | Add a re-load on `conflicts-detected` too (so the banner appears immediately) |
| `components/ConflictBanner.tsx` | Create | Persistent yellow banner at top of `DesktopShell` when `conflictCount > 0` |
| `shell/DesktopShell.tsx` | Modify | Render `<ConflictBanner />` above the main pane |
| `views/ConflictsView.tsx` | Create | Per-task diff + action UI; resolve / dismiss buttons |
| `App.tsx` | Modify | Register `/conflicts/:filename` route |

---

## Task 1 — Add `notify` dependency

**Files:**
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1.1: Add the dep**

In `src-tauri/Cargo.toml`, add to `[dependencies]`:

```toml
notify = "6"
```

- [ ] **Step 1.2: Verify**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: dependencies download, clean build.

- [ ] **Step 1.3: Commit**

```
git add src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "Add notify crate for filesystem watcher"
```

---

## Task 2 — `store.rs` exposes `data_path()` and a `swap_document` method

**Files:**
- Modify: `src-tauri/src/store.rs`

These two small additions let `sync.rs` watch the right directory and replace state when an external write happens.

- [ ] **Step 2.1: Add public methods**

Open `src-tauri/src/store.rs`. The existing `AppState` already has a private `path()` method — promote it to be the public version (already returns `PathBuf`). Verify it's `pub`.

Add a NEW method right after `write`:

```rust
    /// Replace the in-memory document with a freshly parsed one, and update the
    /// hash to match what's now on disk. Called by sync.rs after detecting an
    /// external write.
    pub fn reload_from_bytes(&self, bytes: Vec<u8>) -> Result<()> {
        let doc: Document = serde_json::from_slice(&bytes)?;
        let mut g = self.inner.lock().unwrap();
        g.doc = doc;
        g.last_written_hash = sha256_inline(&bytes);
        Ok(())
    }
```

Right above the existing `fn sha256` (or somewhere accessible), add a private helper that the new method uses (you can just reuse the existing `sha256` function — rename the call appropriately. The above example assumes there's an `sha256_inline` helper; in practice just call the existing `sha256` if it's in scope, or duplicate the impl as `pub(crate) fn sha256_bytes`. The exact naming is fine as long as it compiles.).

Concretely: the existing `fn sha256(bytes: &[u8]) -> [u8; 32]` should already be accessible to `reload_from_bytes` since both live in the same file. Just call `sha256(&bytes)`.

- [ ] **Step 2.2: Verify**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: clean.

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: still 31 passing.

- [ ] **Step 2.3: Commit**

```
git add src-tauri/src/store.rs
git commit -m "Add AppState::reload_from_bytes for external-change path"
```

---

## Task 3 — `sync.rs`: watcher with debounce + hash suppression

**Files:**
- Create: `src-tauri/src/sync.rs`
- Modify: `src-tauri/src/lib.rs` (`pub mod sync;`)

- [ ] **Step 3.1: Write the module**

Create `src-tauri/src/sync.rs`:

```rust
use crate::store::AppState;
use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

const DEBOUNCE_MS: u64 = 250;
const STORE_CHANGED:       &str = "store-changed";
const CONFLICTS_DETECTED:  &str = "conflicts-detected";

pub struct SyncHandle {
    _watcher: RecommendedWatcher,
    _thread:  thread::JoinHandle<()>,
}

pub fn start(app: AppHandle, data_path: PathBuf) -> notify::Result<SyncHandle> {
    let parent = data_path.parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| PathBuf::from("."));
    let (tx, rx) = channel::<notify::Result<Event>>();
    let mut watcher = RecommendedWatcher::new(tx, Config::default())?;
    watcher.watch(&parent, RecursiveMode::NonRecursive)?;

    let app_for_thread   = app.clone();
    let path_for_thread  = data_path.clone();
    let last_event_at    = Arc::new(Mutex::new(None::<Instant>));
    let pending          = Arc::clone(&last_event_at);

    let handle = thread::spawn(move || {
        loop {
            match rx.recv() {
                Ok(_event_result) => {
                    // Coalesce burst of events.
                    *pending.lock().unwrap() = Some(Instant::now());
                    thread::sleep(Duration::from_millis(DEBOUNCE_MS));

                    let due = match *pending.lock().unwrap() {
                        Some(t) => t.elapsed() >= Duration::from_millis(DEBOUNCE_MS),
                        None => false,
                    };
                    if !due { continue; }
                    *pending.lock().unwrap() = None;

                    process_change(&app_for_thread, &path_for_thread);
                }
                Err(_) => break, // channel closed; watcher dropped
            }
        }
    });

    Ok(SyncHandle { _watcher: watcher, _thread: handle })
}

fn process_change(app: &AppHandle, data_path: &Path) {
    // External-change reload path: read file, compare hash to last_written.
    if let Some(state) = app.try_state::<AppState>() {
        let bytes = match std::fs::read(data_path) {
            Ok(b) => b,
            Err(_) => return, // file gone or unreadable; leave state alone
        };
        let mut hasher = Sha256::new();
        hasher.update(&bytes);
        let on_disk_hash: [u8; 32] = hasher.finalize().into();

        let last_written = state.last_written_hash();
        if on_disk_hash != last_written {
            // External edit. Try to reload; if parse fails, surface but don't crash state.
            match state.reload_from_bytes(bytes) {
                Ok(()) => { let _ = app.emit(STORE_CHANGED, ()); }
                Err(_) => { /* TODO: surface a "data file unreadable" toast */ }
            }
        }
    }

    // Always (re)scan for conflict files; emit if any.
    let conflicts = scan_conflict_files(data_path);
    if !conflicts.is_empty() {
        let _ = app.emit(CONFLICTS_DETECTED, &conflicts);
    }
}

pub fn scan_conflict_files(data_path: &Path) -> Vec<String> {
    let parent = match data_path.parent() {
        Some(p) => p,
        None => return Vec::new(),
    };
    let stem = data_path.file_stem().and_then(|s| s.to_str()).unwrap_or("tasks");
    let mut out = Vec::new();
    let entries = match std::fs::read_dir(parent) {
        Ok(e) => e,
        Err(_) => return Vec::new(),
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        let lower = name.to_lowercase();
        if lower.contains("conflict")
            && lower.starts_with(&stem.to_lowercase())
            && lower.ends_with(".json")
            && name != data_path.file_name().and_then(|n| n.to_str()).unwrap_or("")
        {
            out.push(entry.path().to_string_lossy().to_string());
        }
    }
    out.sort();
    out
}
```

Notes:
- We swallow `notify::Result<Event>` and treat any signal as "something changed in the parent dir." The hash-compare downstream is what decides whether we actually do work.
- The debounce is intentionally simple: on each event, set "pending=now", sleep DEBOUNCE_MS, and only fire if the timestamp hasn't been bumped during the sleep. Multiple events within 250 ms collapse to one.
- `app.try_state::<AppState>()` returns `Option<State<AppState>>`; we early-return if the state isn't managed yet (shouldn't happen post-setup but it's defensive).

- [ ] **Step 3.2: Register the module**

Edit `src-tauri/src/lib.rs`. Add `pub mod sync;` in alphabetical order (`commands, error, model, parse, search, store, sync`).

- [ ] **Step 3.3: Verify**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: clean. (Warnings about unused `EventKind` or `last_event_at` are acceptable for now — Task 4 tests will use the function paths.)

- [ ] **Step 3.4: Commit**

```
git add src-tauri/src/sync.rs src-tauri/src/lib.rs
git commit -m "Add sync.rs: notify-based watcher with debounce + hash suppression + conflict scan"
```

---

## Task 4 — Integration tests for sync.rs (watcher + conflict scanner)

**Files:**
- Create: `src-tauri/tests/sync_integration.rs`

We can't easily test the full watcher loop in CI without flaky timing assumptions, but `scan_conflict_files` is a pure function over a directory — perfectly testable. And we test the hash-suppression bookkeeping through `AppState`.

- [ ] **Step 4.1: Write the tests**

Create `src-tauri/tests/sync_integration.rs`:

```rust
use pansutong_lib::sync::scan_conflict_files;
use std::fs;
use std::path::PathBuf;
use tempfile::tempdir;

fn touch(path: &PathBuf, contents: &str) {
    fs::write(path, contents).unwrap();
}

#[test]
fn scanner_finds_syncthing_conflict_siblings() {
    let dir  = tempdir().unwrap();
    let data = dir.path().join("tasks.json");
    touch(&data, "{}");

    let c1 = dir.path().join("tasks.sync-conflict-20260528-123045-7AB2C9D.json");
    let c2 = dir.path().join("tasks.sync-conflict-20260528-090000-ZZZZZ.json");
    touch(&c1, "{}");
    touch(&c2, "{}");

    let found = scan_conflict_files(&data);
    assert_eq!(found.len(), 2);
    assert!(found.iter().any(|p| p == &c1.to_string_lossy()));
    assert!(found.iter().any(|p| p == &c2.to_string_lossy()));
}

#[test]
fn scanner_finds_dropbox_style_conflicts() {
    let dir  = tempdir().unwrap();
    let data = dir.path().join("tasks.json");
    touch(&data, "{}");

    // Dropbox/iCloud-style with parens.
    let c = dir.path().join("tasks (conflicted copy 2026-05-28).json");
    touch(&c, "{}");

    let found = scan_conflict_files(&data);
    assert!(found.iter().any(|p| p == &c.to_string_lossy()),
            "expected to find dropbox-style sibling; got {:?}", found);
}

#[test]
fn scanner_ignores_the_data_file_itself() {
    let dir  = tempdir().unwrap();
    let data = dir.path().join("tasks.json");
    touch(&data, "{}");
    let found = scan_conflict_files(&data);
    assert!(found.is_empty());
}

#[test]
fn scanner_ignores_unrelated_files() {
    let dir  = tempdir().unwrap();
    let data = dir.path().join("tasks.json");
    touch(&data, "{}");
    touch(&dir.path().join("notes.txt"), "hi");
    touch(&dir.path().join("readme.md"),  "hi");
    let found = scan_conflict_files(&data);
    assert!(found.is_empty());
}

#[test]
fn scanner_handles_missing_parent_directory() {
    // Path whose parent doesn't exist.
    let bogus = PathBuf::from("/this/path/does/not/exist/tasks.json");
    let found = scan_conflict_files(&bogus);
    assert!(found.is_empty());
}
```

- [ ] **Step 4.2: Verify**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test sync_integration`
Expected: 5 passed.

Run the full suite: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: 31 prior + 5 sync = 36 passed.

- [ ] **Step 4.3: Commit**

```
git add src-tauri/tests/sync_integration.rs
git commit -m "Test scan_conflict_files: syncthing, dropbox, ignores self, no-parent"
```

---

## Task 5 — `conflict.rs`: pure diff + apply logic

**Files:**
- Create: `src-tauri/src/conflict.rs`
- Modify: `src-tauri/src/lib.rs` (`pub mod conflict;`)

- [ ] **Step 5.1: Write the module**

Create `src-tauri/src/conflict.rs`:

```rust
use crate::model::{Document, Task};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum TaskDiff {
    /// Task exists in both, with at least one field differing.
    Differs { id: String, mine: Task, theirs: Task },
    /// Task exists only in our document.
    OnlyMine   { id: String, mine: Task },
    /// Task exists only in the conflict file.
    OnlyTheirs { id: String, theirs: Task },
}

/// Per-task decision the user makes in the resolve UI.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum Decision {
    /// Differs → keep mine (discard theirs). Equivalent to OnlyMine → keep.
    KeepMine   { id: String },
    /// Differs → keep theirs. Equivalent to OnlyTheirs → import.
    KeepTheirs { id: String },
    /// Differs → keep both (theirs gets a new id and is appended).
    KeepBoth   { id: String },
    /// OnlyMine → drop. OnlyTheirs → ignore. Either way, the task does NOT appear in the merged doc.
    Drop       { id: String },
}

/// Compare two documents by task id. Stable order: existing-mine first, then only-theirs at the end.
pub fn diff_tasks(mine: &Document, theirs: &Document) -> Vec<TaskDiff> {
    let theirs_by_id: HashMap<&str, &Task> =
        theirs.tasks.iter().map(|t| (t.id.as_str(), t)).collect();
    let mine_by_id: HashMap<&str, &Task> =
        mine.tasks.iter().map(|t| (t.id.as_str(), t)).collect();

    let mut out = Vec::new();

    for t in &mine.tasks {
        match theirs_by_id.get(t.id.as_str()) {
            Some(theirs_t) if task_equal(t, theirs_t) => continue,
            Some(theirs_t) => out.push(TaskDiff::Differs {
                id: t.id.clone(), mine: t.clone(), theirs: (*theirs_t).clone(),
            }),
            None => out.push(TaskDiff::OnlyMine { id: t.id.clone(), mine: t.clone() }),
        }
    }
    for t in &theirs.tasks {
        if !mine_by_id.contains_key(t.id.as_str()) {
            out.push(TaskDiff::OnlyTheirs { id: t.id.clone(), theirs: t.clone() });
        }
    }
    out
}

/// Apply a list of decisions to produce a merged task list. Tasks not mentioned
/// in `decisions` default to "keep mine"; this is the safe default if the user
/// only resolves the differing items.
pub fn apply_decisions(
    mine: &Document,
    theirs: &Document,
    decisions: &[Decision],
) -> Vec<Task> {
    let theirs_by_id: HashMap<&str, &Task> =
        theirs.tasks.iter().map(|t| (t.id.as_str(), t)).collect();
    let mut decided: HashMap<&str, &Decision> = HashMap::new();
    for d in decisions {
        decided.insert(decision_id(d), d);
    }

    let mut out: Vec<Task> = Vec::new();
    let mut already: std::collections::HashSet<String> = std::collections::HashSet::new();

    for t in &mine.tasks {
        let id = t.id.as_str();
        let action = decided.get(id);
        match action {
            None | Some(Decision::KeepMine { .. }) => {
                out.push(t.clone());
                already.insert(t.id.clone());
            }
            Some(Decision::KeepTheirs { .. }) => {
                if let Some(theirs_t) = theirs_by_id.get(id) {
                    out.push((*theirs_t).clone());
                    already.insert(t.id.clone());
                } else {
                    // theirs is missing → "keep theirs" effectively means drop mine.
                }
            }
            Some(Decision::KeepBoth { .. }) => {
                out.push(t.clone());
                already.insert(t.id.clone());
                if let Some(theirs_t) = theirs_by_id.get(id) {
                    let mut copy = (*theirs_t).clone();
                    copy.id = crate::model::new_task_id(); // give theirs a fresh id
                    out.push(copy);
                }
            }
            Some(Decision::Drop { .. }) => { /* skip */ }
        }
    }

    // Add only-theirs tasks the user opted to import.
    for t in &theirs.tasks {
        if already.contains(&t.id) { continue; }
        if let Some(d) = decided.get(t.id.as_str()) {
            match d {
                Decision::KeepTheirs { .. } | Decision::KeepBoth { .. } => {
                    let mut copy = t.clone();
                    // No id collision (we already skipped already-emitted), keep id as-is.
                    out.push(copy);
                }
                _ => {}
            }
        }
    }

    out
}

fn decision_id(d: &Decision) -> &str {
    match d {
        Decision::KeepMine   { id } |
        Decision::KeepTheirs { id } |
        Decision::KeepBoth   { id } |
        Decision::Drop       { id } => id.as_str(),
    }
}

fn task_equal(a: &Task, b: &Task) -> bool {
    a.title == b.title
        && a.done == b.done
        && a.due_date == b.due_date
        && a.scheduled_date == b.scheduled_date
        && a.priority == b.priority
        && a.notes == b.notes
        && a.tag_ids == b.tag_ids
}
```

Notes:
- Projects and tags are NOT diffed by this phase. The merge always keeps `mine.projects` and `mine.tags`. Theirs project/tag definitions are ignored. This is intentional: projects and tags rarely change, and a per-tag merge UI would explode scope. Document this in the Settings UI.
- `KeepBoth` for a Differs case generates a new id for the "theirs" copy so they don't collide. For `OnlyTheirs` items the id is preserved (no conflict possible).

- [ ] **Step 5.2: Declare in lib.rs**

Add `pub mod conflict;` in alphabetical order (becomes: `commands, conflict, error, model, parse, search, store, sync`).

- [ ] **Step 5.3: Verify**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: clean.

- [ ] **Step 5.4: Commit**

```
git add src-tauri/src/conflict.rs src-tauri/src/lib.rs
git commit -m "Add conflict.rs: pure diff + decision-based merge for tasks"
```

---

## Task 6 — Tests for `conflict.rs`

**Files:**
- Create: `src-tauri/tests/conflict_unit.rs`

- [ ] **Step 6.1: Write the tests**

Create `src-tauri/tests/conflict_unit.rs`:

```rust
use pansutong_lib::conflict::{apply_decisions, diff_tasks, Decision, TaskDiff};
use pansutong_lib::model::{Document, Task};

fn mk(id: &str, title: &str, done: bool) -> Task {
    Task {
        id: id.into(),
        title: title.into(),
        done,
        due_date: None,
        scheduled_date: None,
        priority: None,
        notes: String::new(),
        tag_ids: Vec::new(),
        created_at: 0,
        completed_at: None,
    }
}

fn doc(tasks: Vec<Task>) -> Document {
    let mut d = Document::default();
    d.tasks = tasks;
    d
}

#[test]
fn diff_finds_differs_only_mine_only_theirs() {
    let mine   = doc(vec![mk("a", "A1", false), mk("b", "B",  false)]);
    let theirs = doc(vec![mk("a", "A2", false), mk("c", "C",  false)]);
    let d = diff_tasks(&mine, &theirs);
    assert_eq!(d.len(), 3);
    let mut differs_seen = false;
    let mut mine_seen    = false;
    let mut theirs_seen  = false;
    for item in &d {
        match item {
            TaskDiff::Differs   { id, .. } if id == "a" => differs_seen = true,
            TaskDiff::OnlyMine  { id, .. } if id == "b" => mine_seen = true,
            TaskDiff::OnlyTheirs{ id, .. } if id == "c" => theirs_seen = true,
            _ => panic!("unexpected diff item {item:?}"),
        }
    }
    assert!(differs_seen && mine_seen && theirs_seen);
}

#[test]
fn diff_skips_identical_tasks() {
    let mine   = doc(vec![mk("a", "Same", false)]);
    let theirs = doc(vec![mk("a", "Same", false)]);
    let d = diff_tasks(&mine, &theirs);
    assert!(d.is_empty());
}

#[test]
fn apply_keep_mine_preserves_my_version() {
    let mine   = doc(vec![mk("a", "Mine",   false)]);
    let theirs = doc(vec![mk("a", "Theirs", false)]);
    let merged = apply_decisions(&mine, &theirs, &[
        Decision::KeepMine { id: "a".into() }
    ]);
    assert_eq!(merged.len(), 1);
    assert_eq!(merged[0].title, "Mine");
}

#[test]
fn apply_keep_theirs_overwrites_mine() {
    let mine   = doc(vec![mk("a", "Mine",   false)]);
    let theirs = doc(vec![mk("a", "Theirs", false)]);
    let merged = apply_decisions(&mine, &theirs, &[
        Decision::KeepTheirs { id: "a".into() }
    ]);
    assert_eq!(merged.len(), 1);
    assert_eq!(merged[0].title, "Theirs");
}

#[test]
fn apply_keep_both_clones_theirs_with_new_id() {
    let mine   = doc(vec![mk("a", "Mine",   false)]);
    let theirs = doc(vec![mk("a", "Theirs", false)]);
    let merged = apply_decisions(&mine, &theirs, &[
        Decision::KeepBoth { id: "a".into() }
    ]);
    assert_eq!(merged.len(), 2);
    assert!(merged.iter().any(|t| t.title == "Mine"   && t.id == "a"));
    assert!(merged.iter().any(|t| t.title == "Theirs" && t.id != "a"));
}

#[test]
fn apply_drop_removes_task() {
    let mine   = doc(vec![mk("a", "Mine", false), mk("b", "Keep", false)]);
    let theirs = doc(vec![]);
    let merged = apply_decisions(&mine, &theirs, &[
        Decision::Drop { id: "a".into() }
    ]);
    assert_eq!(merged.len(), 1);
    assert_eq!(merged[0].id, "b");
}

#[test]
fn apply_only_theirs_keep_theirs_imports() {
    let mine   = doc(vec![mk("a", "A", false)]);
    let theirs = doc(vec![mk("c", "C", false)]);
    let merged = apply_decisions(&mine, &theirs, &[
        Decision::KeepTheirs { id: "c".into() }
    ]);
    assert_eq!(merged.len(), 2);
    assert!(merged.iter().any(|t| t.id == "a"));
    assert!(merged.iter().any(|t| t.id == "c"));
}

#[test]
fn unmentioned_tasks_default_to_keep_mine() {
    let mine   = doc(vec![mk("a", "A", false), mk("b", "B", false)]);
    let theirs = doc(vec![mk("a", "A2", false)]);
    let merged = apply_decisions(&mine, &theirs, &[]);  // empty decisions
    assert_eq!(merged.len(), 2);
    assert!(merged.iter().any(|t| t.id == "a" && t.title == "A"));  // mine wins
    assert!(merged.iter().any(|t| t.id == "b" && t.title == "B"));
}
```

- [ ] **Step 6.2: Verify**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test conflict_unit`
Expected: 8 passed.

Full suite: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: 36 prior + 8 conflict = 44 passed.

- [ ] **Step 6.3: Commit**

```
git add src-tauri/tests/conflict_unit.rs
git commit -m "Test conflict.rs diff + apply: differs, only-mine, only-theirs, drop, both"
```

---

## Task 7 — Commands for the conflict UI

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 7.1: Add the 4 commands**

Open `src-tauri/src/commands.rs`. Add at the top with other imports:

```rust
use crate::conflict::{apply_decisions, diff_tasks, Decision, TaskDiff};
use crate::sync::scan_conflict_files;
use std::path::PathBuf;
```

Append at the end of the file:

```rust
#[tauri::command]
pub fn list_conflicts(state: State<'_, AppState>) -> Vec<String> {
    let path = state.path();
    scan_conflict_files(&path)
}

#[tauri::command]
pub fn read_conflict(conflict_path: String, state: State<'_, AppState>) -> Result<Vec<TaskDiff>> {
    let bytes = std::fs::read(&conflict_path)?;
    let theirs: crate::model::Document = serde_json::from_slice(&bytes)?;
    let diffs = state.read(|d| diff_tasks(d, &theirs));
    Ok(diffs)
}

#[derive(Deserialize)]
pub struct ResolveConflictInput {
    pub conflict_path: String,
    pub decisions: Vec<Decision>,
}

#[tauri::command]
pub fn resolve_conflict(
    input: ResolveConflictInput,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<()> {
    let bytes = std::fs::read(&input.conflict_path)?;
    let theirs: crate::model::Document = serde_json::from_slice(&bytes)?;
    state.write(|d| {
        d.tasks = apply_decisions(d, &theirs, &input.decisions);
        Ok(())
    })?;
    // Delete the conflict file after a successful merge write.
    let _ = std::fs::remove_file(&input.conflict_path);
    emit_changed(&app);
    let _ = app.emit("conflicts-detected", &scan_conflict_files(&PathBuf::from(state.path())));
    Ok(())
}

#[tauri::command]
pub fn dismiss_conflict(conflict_path: String, app: AppHandle, state: State<'_, AppState>) -> Result<()> {
    // Deletes the conflict file without merging — for cases where the user
    // verifies it's stale junk.
    let _ = std::fs::remove_file(&conflict_path);
    let _ = app.emit("conflicts-detected", &scan_conflict_files(&PathBuf::from(state.path())));
    Ok(())
}
```

- [ ] **Step 7.2: Register in lib.rs**

Add to the `generate_handler![ ... ]` list:

```rust
commands::list_conflicts,
commands::read_conflict,
commands::resolve_conflict,
commands::dismiss_conflict,
```

- [ ] **Step 7.3: Verify**

`cargo check` clean; `cargo test` still 44 passing.

- [ ] **Step 7.4: Commit**

```
git add src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "Add list_conflicts, read_conflict, resolve_conflict, dismiss_conflict commands"
```

---

## Task 8 — Wire the watcher into `lib.rs` setup

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 8.1: Start the watcher**

In `src-tauri/src/lib.rs`, the existing `setup(|app| { ... })` block opens `AppState` and calls `app.manage(state)`. After `app.manage(state)`, also start the sync watcher:

```rust
        let handle = app.handle().clone();
        let data_path = path.clone();
        if let Err(e) = crate::sync::start(handle, data_path) {
            eprintln!("warning: filesystem watcher failed to start: {e}");
        }
```

The full updated `setup` block now reads roughly:

```rust
        .setup(|app| {
            let data_dir = app.path()
                .app_data_dir()
                .expect("app_data_dir resolvable");
            std::fs::create_dir_all(&data_dir).expect("create app data dir");
            let path = data_dir.join("tasks.json");
            let state = AppState::open(path.clone()).expect("open store");
            app.manage(state);

            let handle = app.handle().clone();
            if let Err(e) = crate::sync::start(handle, path) {
                eprintln!("warning: filesystem watcher failed to start: {e}");
            }

            Ok(())
        })
```

Notes:
- We deliberately `eprintln!` and continue if the watcher fails to start — the app should still be usable, just without live sync.
- The `SyncHandle` returned by `start` is dropped on the next line because we don't store it. That's actually a bug: when `SyncHandle` drops, the `_watcher` field drops, which stops the watcher. Fix:

Add a small struct holding the handle, and `app.manage(handle)` to keep it alive for the app's lifetime:

```rust
            match crate::sync::start(handle, path) {
                Ok(sync_handle) => { app.manage(sync_handle); }
                Err(e) => { eprintln!("warning: filesystem watcher failed to start: {e}"); }
            }
```

- [ ] **Step 8.2: Verify**

`cargo check` clean. `cargo test` still 44 passing.

- [ ] **Step 8.3: Commit**

```
git add src-tauri/src/lib.rs
git commit -m "Start sync watcher in setup hook; keep SyncHandle alive via app.manage"
```

---

## Task 9 — `lib/tauri.ts`: types and wrappers

**Files:**
- Modify: `src/lib/tauri.ts`

- [ ] **Step 9.1: Add types**

Open `src/lib/tauri.ts`. Add after the `Document` type:

```ts
export type TaskDiff =
  | { kind: "differs";    id: string; mine: Task;   theirs: Task }
  | { kind: "only_mine";  id: string; mine: Task }
  | { kind: "only_theirs"; id: string; theirs: Task };

export type Decision =
  | { action: "keep_mine";   id: string }
  | { action: "keep_theirs"; id: string }
  | { action: "keep_both";   id: string }
  | { action: "drop";        id: string };
```

Add to the `api` object:

```ts
  listConflicts:    ()             => invoke<string[]>("list_conflicts"),
  readConflict:     (path: string) => invoke<TaskDiff[]>("read_conflict", { conflictPath: path }),
  resolveConflict:  (path: string, decisions: Decision[]) =>
                                      invoke<void>("resolve_conflict",
                                        { input: { conflict_path: path, decisions } }),
  dismissConflict:  (path: string) => invoke<void>("dismiss_conflict", { conflictPath: path }),
```

(Tauri converts JS camelCase `conflictPath` → Rust `conflict_path` automatically.)

- [ ] **Step 9.2: Verify**

`npx tsc --noEmit` — 0 errors.

- [ ] **Step 9.3: Commit**

```
git add src/lib/tauri.ts
git commit -m "Add TaskDiff, Decision types and wrappers for conflict commands"
```

---

## Task 10 — `useConflicts` hook + `ConflictBanner` component + DesktopShell wiring

**Files:**
- Create: `src/state/conflicts.ts`
- Create: `src/components/ConflictBanner.tsx`
- Modify: `src/shell/DesktopShell.tsx`
- Modify: `src/styles/global.css`

- [ ] **Step 10.1: `state/conflicts.ts`**

Create `src/state/conflicts.ts`:

```ts
import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api } from "../lib/tauri";

export function useConflicts(): string[] {
  const [files, setFiles] = useState<string[]>([]);

  useEffect(() => {
    let mounted = true;
    const refresh = async () => {
      try {
        const list = await api.listConflicts();
        if (mounted) setFiles(list);
      } catch { /* ignore */ }
    };

    void refresh();
    const unlistenPromise = listen<string[]>("conflicts-detected", evt => {
      if (mounted) setFiles(evt.payload);
    });

    return () => {
      mounted = false;
      void unlistenPromise.then(fn => fn());
    };
  }, []);

  return files;
}
```

- [ ] **Step 10.2: `components/ConflictBanner.tsx`**

Create `src/components/ConflictBanner.tsx`:

```tsx
import { Link } from "react-router-dom";
import { useConflicts } from "../state/conflicts";

export function ConflictBanner() {
  const files = useConflicts();
  if (files.length === 0) return null;

  const first = files[0];
  const filename = first.split(/[\\/]/).pop() ?? first;

  return (
    <div className="conflict-banner" role="alert">
      <span>
        {files.length === 1
          ? `1 sync conflict — ${filename}`
          : `${files.length} sync conflicts`}
      </span>
      <Link className="conflict-banner-link" to={`/conflicts/${encodeURIComponent(first)}`}>
        Review →
      </Link>
    </div>
  );
}
```

- [ ] **Step 10.3: Wire into DesktopShell**

Open `src/shell/DesktopShell.tsx`. Import `ConflictBanner` and render it inside the main pane above `{children}`:

```tsx
import { ConflictBanner } from "../components/ConflictBanner";
// ...
export function DesktopShell({ doc, indexes, children }: Props) {
  return (
    <div className="desktop-shell">
      <Sidebar doc={doc} indexes={indexes} />
      <main className="desktop-main">
        <ConflictBanner />
        {children}
      </main>
    </div>
  );
}
```

- [ ] **Step 10.4: Styles**

Append to `src/styles/global.css`:

```css
.conflict-banner {
  background: #fef3c7;
  color: #78350f;
  border: 1px solid #fde68a;
  border-radius: var(--radius-md);
  padding: var(--space-2) var(--space-3);
  margin-bottom: var(--space-3);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  font-size: 0.85rem;
}
.conflict-banner-link {
  color: #b45309;
  font-weight: 600;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) .conflict-banner {
    background: #3d2a08;
    color: #fde68a;
    border-color: #92400e;
  }
  :root:not([data-theme="light"]) .conflict-banner-link { color: #fcd34d; }
}
:root[data-theme="dark"] .conflict-banner {
  background: #3d2a08; color: #fde68a; border-color: #92400e;
}
:root[data-theme="dark"] .conflict-banner-link { color: #fcd34d; }
```

- [ ] **Step 10.5: Verify**

`npx tsc --noEmit`, `npm test`. Expected: tsc clean; vitest 20 passing.

- [ ] **Step 10.6: Commit**

```
git add src/state/conflicts.ts src/components/ConflictBanner.tsx src/shell/DesktopShell.tsx src/styles/global.css
git commit -m "Add useConflicts hook + ConflictBanner shown in DesktopShell"
```

---

## Task 11 — `ConflictsView` per-task resolve UI

**Files:**
- Create: `src/views/ConflictsView.tsx`
- Modify: `src/App.tsx`
- Modify: `src/styles/global.css`

- [ ] **Step 11.1: Write the view**

Create `src/views/ConflictsView.tsx`:

```tsx
import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api, Decision, Task, TaskDiff } from "../lib/tauri";

export function ConflictsView() {
  const { filename } = useParams<{ filename: string }>();
  const path = filename ? decodeURIComponent(filename) : "";
  const navigate = useNavigate();

  const [diffs, setDiffs] = useState<TaskDiff[] | null>(null);
  const [chosen, setChosen] = useState<Record<string, Decision["action"]>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!path) return;
    api.readConflict(path)
      .then(setDiffs)
      .catch(err => setError(String(err)));
  }, [path]);

  if (!path) return <p className="view-empty">No conflict selected.</p>;
  if (error) return <p className="composer-error">{error}</p>;
  if (!diffs) return <p className="view-empty">Loading conflict…</p>;

  const decide = (id: string, action: Decision["action"]) => {
    setChosen(s => ({ ...s, [id]: action }));
  };

  const allDecided = diffs.every(d => chosen[d.id] !== undefined);
  const fileLabel  = path.split(/[\\/]/).pop() ?? path;

  const submit = async () => {
    setBusy(true);
    try {
      const decisions: Decision[] = Object.entries(chosen).map(([id, action]) =>
        ({ action, id }) as Decision
      );
      await api.resolveConflict(path, decisions);
      navigate("/today");
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const dismiss = async () => {
    if (!window.confirm("Discard this conflict file without merging?")) return;
    try { await api.dismissConflict(path); navigate("/today"); }
    catch (err) { setError(String(err)); }
  };

  const useAll = (action: Decision["action"]) => {
    const all: Record<string, Decision["action"]> = {};
    for (const d of diffs) all[d.id] = action;
    setChosen(all);
  };

  return (
    <section>
      <header className="view-header">
        <h1>Sync conflict</h1>
        <p className="view-sub">{fileLabel}</p>
      </header>

      <div className="conflict-bulk">
        <button onClick={() => useAll("keep_mine")}   className="link-button">Use all mine</button>
        <button onClick={() => useAll("keep_theirs")} className="link-button">Use all theirs</button>
      </div>

      {diffs.length === 0
        ? <p className="view-empty">No task differences. (Project/tag differences are ignored in v1.)</p>
        : diffs.map(d => (
          <ConflictRow
            key={d.id}
            diff={d}
            chosen={chosen[d.id]}
            onChoose={action => decide(d.id, action)}
          />
        ))
      }

      <div className="conflict-actions">
        <button onClick={dismiss} className="link-button danger">Discard conflict file</button>
        <button onClick={submit} disabled={!allDecided || busy}>
          {busy ? "Applying…" : "Apply"}
        </button>
      </div>
    </section>
  );
}

function ConflictRow(props: {
  diff: TaskDiff;
  chosen: Decision["action"] | undefined;
  onChoose: (action: Decision["action"]) => void;
}) {
  const { diff, chosen, onChoose } = props;

  if (diff.kind === "differs") {
    return (
      <div className="conflict-row">
        <div className="conflict-row-title">"{diff.mine.title}"</div>
        <div className="conflict-row-side">
          <div className="conflict-side-label">Yours</div>
          <TaskSummary task={diff.mine} />
        </div>
        <div className="conflict-row-side">
          <div className="conflict-side-label">Theirs</div>
          <TaskSummary task={diff.theirs} />
        </div>
        <div className="conflict-row-actions">
          <Pick label="Keep mine"   active={chosen === "keep_mine"}   onClick={() => onChoose("keep_mine")} />
          <Pick label="Keep theirs" active={chosen === "keep_theirs"} onClick={() => onChoose("keep_theirs")} />
          <Pick label="Keep both"   active={chosen === "keep_both"}   onClick={() => onChoose("keep_both")} />
        </div>
      </div>
    );
  }
  if (diff.kind === "only_mine") {
    return (
      <div className="conflict-row">
        <div className="conflict-row-title">"{diff.mine.title}" <span className="conflict-tag">only on yours</span></div>
        <TaskSummary task={diff.mine} />
        <div className="conflict-row-actions">
          <Pick label="Keep" active={chosen === "keep_mine"} onClick={() => onChoose("keep_mine")} />
          <Pick label="Drop" active={chosen === "drop"}      onClick={() => onChoose("drop")} />
        </div>
      </div>
    );
  }
  // only_theirs
  return (
    <div className="conflict-row">
      <div className="conflict-row-title">"{diff.theirs.title}" <span className="conflict-tag">only on theirs</span></div>
      <TaskSummary task={diff.theirs} />
      <div className="conflict-row-actions">
        <Pick label="Add to mine" active={chosen === "keep_theirs"} onClick={() => onChoose("keep_theirs")} />
        <Pick label="Ignore"      active={chosen === "drop"}        onClick={() => onChoose("drop")} />
      </div>
    </div>
  );
}

function TaskSummary({ task }: { task: Task }) {
  return (
    <div className="conflict-summary">
      {task.done && <span>✓ done</span>}
      {task.priority && <span>!{task.priority}</span>}
      {task.scheduled_date && <span>sched {task.scheduled_date}</span>}
      {task.due_date       && <span>due {task.due_date}</span>}
      {task.notes && <span className="conflict-notes">"{task.notes.slice(0, 80)}{task.notes.length > 80 ? "…" : ""}"</span>}
    </div>
  );
}

function Pick(props: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className={`conflict-pick ${props.active ? "active" : ""}`}
      onClick={props.onClick}
    >
      {props.label}
    </button>
  );
}
```

- [ ] **Step 11.2: Styles**

Append to `global.css`:

```css
.conflict-bulk {
  display: flex; gap: var(--space-2);
  margin-bottom: var(--space-3);
}
.conflict-row {
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--radius-md);
  padding: var(--space-3);
  margin-bottom: var(--space-2);
}
.conflict-row-title { font-weight: 600; margin-bottom: var(--space-2); }
.conflict-tag {
  background: var(--c-surface-2);
  color: var(--c-text-muted);
  font-size: 0.7rem;
  padding: 2px 6px;
  border-radius: 4px;
  font-weight: 500;
  margin-left: var(--space-2);
}
.conflict-row-side {
  margin-bottom: var(--space-1);
}
.conflict-side-label {
  color: var(--c-text-muted);
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 2px;
}
.conflict-summary {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  color: var(--c-text-muted);
  font-size: 0.82rem;
  margin-bottom: var(--space-1);
}
.conflict-notes { font-style: italic; }
.conflict-row-actions {
  display: flex; gap: var(--space-1);
  margin-top: var(--space-2);
}
.conflict-pick {
  background: var(--c-surface-2);
  color: var(--c-text-muted);
  border-radius: var(--radius-sm);
  padding: var(--space-1) var(--space-3);
  font-size: 0.85rem;
}
.conflict-pick.active {
  background: var(--c-accent);
  color: white;
}
.conflict-actions {
  display: flex;
  justify-content: space-between;
  margin-top: var(--space-4);
}
.conflict-actions button[type=submit], .conflict-actions > button:not(.link-button) {
  background: var(--c-accent);
  color: white;
  border-radius: var(--radius-md);
  padding: var(--space-2) var(--space-4);
}
```

- [ ] **Step 11.3: Register route**

In `src/App.tsx`:

```tsx
import { ConflictsView } from "./views/ConflictsView";
// ...
<Route path="/conflicts/:filename" element={<ConflictsView />} />
```

- [ ] **Step 11.4: Verify**

`npx tsc --noEmit` clean; `npm test` 20 passing.

- [ ] **Step 11.5: Commit**

```
git add src/views/ConflictsView.tsx src/App.tsx src/styles/global.css
git commit -m "Add ConflictsView with per-task resolve + bulk use-all + dismiss"
```

---

## Task 12 — Smoke test the sync surface

This task can be done WITHOUT actually installing Syncthing — we plant the conflict file by hand.

**Files:** none (manual verification)

- [ ] **Step 12.1: Launch dev mode** in a real terminal:

```
npm run tauri dev
```

- [ ] **Step 12.2: Add a task** in Today view: type `Original`.

- [ ] **Step 12.3: Find the data file**

```
%APPDATA%\net.puetsua.pansutong\tasks.json
```

- [ ] **Step 12.4: Plant a conflict file**

Copy `tasks.json` to a sibling named `tasks.sync-conflict-20260528-120000-DEADBEEF.json`. Open the copy and change the task title from `Original` to `Theirs` (or add a new task).

- [ ] **Step 12.5: Within a few seconds**, the app should show a yellow banner at the top: "1 sync conflict — tasks.sync-conflict-…json". If not, the watcher likely isn't firing — check the dev terminal for errors.

- [ ] **Step 12.6: Click "Review →"**

The Conflicts view opens. You see "Differs" entry for the task. Click "Keep theirs" then "Apply".

- [ ] **Step 12.7: Verify**

- App redirects to `/today`.
- The Today view shows the merged title.
- `tasks.sync-conflict-*.json` is gone from the data directory.
- The banner is gone.

- [ ] **Step 12.8: External-edit smoke**

While the app is running, open `tasks.json` in a text editor and add a fresh task at the end of the `tasks` array. Save. Within ~1 second, the new task should appear in Today (or Inbox, depending on its date fields). This confirms the watcher + reload path.

If everything works: Phase 2-sync is complete.

---

## Phase 2-sync done

You now have:
- A filesystem watcher that picks up external writes within ~250 ms.
- Hash-based loop suppression so the app doesn't re-process its own writes.
- Conflict-file scanner that detects Syncthing and Dropbox-style siblings.
- A persistent banner that opens a per-task resolve UI.
- Bulk and per-task decision controls; "drop" and "keep both" semantics.
- Tests: scanner (5), conflict diff/apply (8) — total 44 cargo + 20 vitest.

**Deferred from this phase:**
- Data-file path picker (lives in `pansutong-phase-2b-pathpicker.md` if you decide it's needed).
- Toast for malformed file on external reload.
- History of resolved conflicts (a "resolved-conflicts" log).
- Projects/tags diff (currently `mine` always wins for projects + tags).

**Next plan:** `pansutong-phase-3-quick-capture.md` (global hotkey + capture window) or `pansutong-phase-4-android.md` (the bigger one).
