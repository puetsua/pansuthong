# Pansutong Phase 1 — Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a working Windows desktop task tracker that persists tasks/projects/tags to a single JSON file using the Section 2 data model from the spec, with a Today view and an Inbox view that match the Section 5 visual direction (dense Todoist-style rows). No sync, no Android, no smart-parse composer, no quick-capture window — those come in subsequent phases.

**Architecture:** Rust core holds the canonical `Document` in a `Mutex<AppState>`, persisted to JSON via atomic temp+rename. Frontend is React + TS in the Tauri webview. All state lives in Rust; frontend listens for a `store-changed` event emitted after every successful mutation and rebuilds its derived indexes (`today`, `inbox`, `byProject`, `byTag`) as pure functions of the Document.

**Tech Stack:**
- Tauri 2, Rust 2021, `serde` + `serde_json`
- React 19 + TypeScript + Vite (already scaffolded)
- `chrono` 0.4 with `serde` feature — date-only handling, no time-of-day in v1
- `sha2` 0.10 — hash-based loop suppression (used by Phase 2 sync, field is populated now)
- `uuid` 1 with `v4` — stable IDs
- `tempfile` 3 (dev-dep) — atomic-write integration tests
- `react-router-dom` 7 — frontend routing
- `vitest` 2 + `@testing-library/react` 16 + `jsdom` — frontend tests

**Prerequisites (must be true before Task 1):**
- Rust toolchain installed: `cargo --version` and `rustc --version` must succeed. (See CLAUDE.md — currently missing on this machine; install via https://rustup.rs/ with the MSVC toolchain.)
- `npm install` has been run in the project root.
- `cargo check` succeeds when run from `src-tauri/` (seeds dependency cache).

---

## Phase 1 vs the rest of the design

This plan covers Sections 1–2 (architecture + data model), the desktop-only slice of Section 5 (project structure), and the testing scaffold from Section 6. The remaining sections get their own plans:

- **Section 3 (sync, watcher, conflict UI):** future plan `pansutong-phase-2-sync.md`
- **Section 4 (quick capture):** future plan `pansutong-phase-3-quick-capture.md`
- **Other views (Project, Tag, Upcoming, Search, Settings) + smart-parse composer:** future plan `pansutong-phase-2-views.md`
- **Android target enablement (init, SAF, polling, share intent, widget):** future plan `pansutong-phase-4-android.md`

Each phase produces working software. After this plan ships, you'll have a usable desktop task tracker that just doesn't sync yet.

---

## Files this plan creates or modifies

### Rust (under `src-tauri/`)

| Path | Action | Responsibility |
|---|---|---|
| `Cargo.toml` | Modify | Add `chrono`, `sha2`, `uuid`. Dev-dep: `tempfile` |
| `src/error.rs` | Create | `AppError` enum, `Result<T>` alias, serde-friendly conversion |
| `src/model.rs` | Create | `Document`, `Task`, `Project`, `Tag`, `Settings`, `Priority`, ID generators, derived-state pure functions |
| `src/store.rs` | Create | `AppState` (`Mutex<Document>`), atomic load/save, `last_written_hash` tracking |
| `src/commands.rs` | Create | All `#[tauri::command]` handlers |
| `src/lib.rs` | Modify | Strip old task code; declare modules; configure `tauri::Builder` and command list |
| `tests/storage_integration.rs` | Create | Atomic-write + loop-suppression integration tests |
| `tests/fixtures/empty.json` | Create | Empty `Document` |
| `tests/fixtures/sample.json` | Create | Realistic `Document` with 2 projects, 4 tags, 5 tasks |

### Frontend (under `src/`)

| Path | Action | Responsibility |
|---|---|---|
| `../package.json` | Modify | Add `react-router-dom`, dev-deps for vitest |
| `../tsconfig.json` | Modify | Add vitest types |
| `../vite.config.ts` | Modify | Add `test` block for vitest |
| `styles/tokens.css` | Create | Design tokens — colors, spacing, radii, fonts |
| `styles/global.css` | Create | Resets + body layout |
| `lib/tauri.ts` | Create | Typed `invoke<T>` wrappers |
| `lib/dates.ts` | Create | `todayIso()`, `isOverdue()`, `parseIso()` |
| `state/store.ts` | Create | `useDocument()` hook; subscribes to `store-changed` |
| `state/indexes.ts` | Create | Memoized derived indexes mirroring Rust `model.rs` |
| `state/indexes.test.ts` | Create | Vitest cases using `tests/fixtures/sample.json` |
| `shell/DesktopShell.tsx` | Create | Sidebar + main pane |
| `shell/Sidebar.tsx` | Create | Today / Inbox / Projects / Tags with counts |
| `components/TaskRow.tsx` | Create | Dense row matching mockup B |
| `components/TaskList.tsx` | Create | List wrapper with empty state |
| `components/Composer.tsx` | Create | Plain inline add-task input (no smart-parse this phase) |
| `views/TodayView.tsx` | Create | Today screen |
| `views/InboxView.tsx` | Create | Inbox screen |
| `App.tsx` | Modify | Replace with router + `DesktopShell` |
| `App.css` | Delete | Replaced by `tokens.css` + `global.css` + co-located component styles |
| `tests/fixtures/sample.json` | Create | Same fixture used by Rust + vitest (copy, not symlink — Windows-portable) |

---

## Task 1 — Add Rust dependencies

**Files:**
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1.1: Add new dependency lines**

Edit `src-tauri/Cargo.toml`. Add to `[dependencies]`:

```toml
chrono = { version = "0.4", default-features = false, features = ["clock", "serde"] }
sha2 = "0.10"
uuid = { version = "1", features = ["v4"] }
```

Add a new section at the bottom of the file:

```toml
[dev-dependencies]
tempfile = "3"
```

- [ ] **Step 1.2: Verify the manifest still parses**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: dependencies download, no compile errors. May take several minutes on first run.

- [ ] **Step 1.3: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "Add chrono, sha2, uuid, tempfile dependencies"
```

---

## Task 2 — Create error.rs

**Files:**
- Create: `src-tauri/src/error.rs`

- [ ] **Step 2.1: Write the error type**

Create `src-tauri/src/error.rs`:

```rust
use serde::{Serialize, Serializer};
use std::io;

#[derive(Debug)]
pub enum AppError {
    Io(io::Error),
    Serde(serde_json::Error),
    NotFound(String),
    Invalid(String),
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AppError::Io(e)        => write!(f, "io: {e}"),
            AppError::Serde(e)     => write!(f, "serde: {e}"),
            AppError::NotFound(s)  => write!(f, "not found: {s}"),
            AppError::Invalid(s)   => write!(f, "invalid: {s}"),
        }
    }
}

impl std::error::Error for AppError {}

impl From<io::Error> for AppError {
    fn from(e: io::Error) -> Self { AppError::Io(e) }
}

impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self { AppError::Serde(e) }
}

// Tauri commands need errors that serialize.
impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, AppError>;
```

- [ ] **Step 2.2: Commit**

```bash
git add src-tauri/src/error.rs
git commit -m "Add AppError type for serializable Tauri-command errors"
```

(No standalone test — `error.rs` is exercised by every later task.)

---

## Task 3 — model.rs: types and ID generators

**Files:**
- Create: `src-tauri/src/model.rs`

- [ ] **Step 3.1: Write Priority and ID helpers first**

Create `src-tauri/src/model.rs`:

```rust
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Priority {
    Low,
    Med,
    High,
}

/// Shortened uuid (12 hex chars) with a type prefix. Stable across devices.
fn short_id(prefix: &str) -> String {
    let hex = Uuid::new_v4().simple().to_string();
    format!("{prefix}_{}", &hex[..12])
}

pub fn new_task_id()    -> String { short_id("k") }
pub fn new_project_id() -> String { short_id("p") }
pub fn new_tag_id()     -> String { short_id("t") }
```

- [ ] **Step 3.2: Add the Settings, Project, Tag, Task, Document types**

Append to `model.rs`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    pub data_file: Option<String>,
    pub theme: String,        // "auto" | "light" | "dark"
    pub device_id: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            data_file: None,
            theme: "auto".into(),
            device_id: short_id("d"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub id:    String,
    pub name:  String,
    pub color: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tag {
    pub id:    String,
    pub name:  String,
    pub color: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub project_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    pub id:    String,
    pub title: String,
    pub done:  bool,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub due_date: Option<NaiveDate>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub scheduled_date: Option<NaiveDate>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub priority: Option<Priority>,
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub tag_ids: Vec<String>,
    pub created_at:   i64,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub completed_at: Option<i64>,
}

const CURRENT_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Document {
    pub version:  u32,
    #[serde(default)]
    pub settings: Settings,
    #[serde(default)]
    pub projects: Vec<Project>,
    #[serde(default)]
    pub tags:     Vec<Tag>,
    #[serde(default)]
    pub tasks:    Vec<Task>,
}

impl Default for Document {
    fn default() -> Self {
        Self {
            version:  CURRENT_VERSION,
            settings: Settings::default(),
            projects: Vec::new(),
            tags:     Vec::new(),
            tasks:    Vec::new(),
        }
    }
}
```

- [ ] **Step 3.3: Verify it compiles**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: clean. Warnings about `lib.rs` referencing things that no longer exist are OK — we fix lib.rs in Task 7.

If `cargo check` fails because `lib.rs` references old types, add `mod error; mod model;` at the top of `lib.rs` and ignore the old code for now — it gets rewritten in Task 7.

- [ ] **Step 3.4: Commit**

```bash
git add src-tauri/src/model.rs src-tauri/src/lib.rs
git commit -m "Add model types: Document, Task, Project, Tag, Settings"
```

---

## Task 4 — model.rs: derived-state pure functions

**Files:**
- Modify: `src-tauri/src/model.rs`

- [ ] **Step 4.1: Add derivation functions**

Append to `model.rs`:

```rust
use std::collections::HashMap;

impl Document {
    /// Tag id → its (optional) project id.
    pub fn tag_to_project(&self) -> HashMap<&str, &str> {
        self.tags.iter()
            .filter_map(|t| t.project_id.as_deref().map(|p| (t.id.as_str(), p)))
            .collect()
    }

    /// True if the task should appear in project P.
    pub fn task_in_project(&self, task: &Task, project_id: &str) -> bool {
        let m = self.tag_to_project();
        task.tag_ids.iter().any(|tid| m.get(tid.as_str()) == Some(&project_id))
    }

    /// True if the task is in Inbox (no project-linked tag).
    pub fn task_in_inbox(&self, task: &Task) -> bool {
        let m = self.tag_to_project();
        task.tag_ids.iter().all(|tid| !m.contains_key(tid.as_str()))
    }

    /// Today: scheduled today, OR (due < today AND !done), OR due == today.
    pub fn tasks_today(&self, today: NaiveDate) -> Vec<&Task> {
        self.tasks.iter().filter(|t| {
            if t.scheduled_date == Some(today) { return true; }
            if let Some(due) = t.due_date {
                if due == today { return true; }
                if due < today && !t.done { return true; }
            }
            false
        }).collect()
    }

    pub fn tasks_inbox(&self) -> Vec<&Task> {
        self.tasks.iter().filter(|t| self.task_in_inbox(t)).collect()
    }

    pub fn tasks_for_project(&self, project_id: &str) -> Vec<&Task> {
        self.tasks.iter().filter(|t| self.task_in_project(t, project_id)).collect()
    }

    pub fn tasks_for_tag(&self, tag_id: &str) -> Vec<&Task> {
        self.tasks.iter().filter(|t| t.tag_ids.iter().any(|id| id == tag_id)).collect()
    }
}
```

- [ ] **Step 4.2: Verify**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: clean.

- [ ] **Step 4.3: Commit**

```bash
git add src-tauri/src/model.rs
git commit -m "Add derived-state functions: today, inbox, by-project, by-tag"
```

---

## Task 5 — Test model.rs derived state

**Files:**
- Create: `src-tauri/tests/fixtures/sample.json`
- Create: `src-tauri/tests/fixtures/empty.json`
- Create: `src-tauri/tests/model_derivations.rs`

- [ ] **Step 5.1: Write the empty fixture**

Create `src-tauri/tests/fixtures/empty.json`:

```json
{
  "version": 1,
  "settings": { "data_file": null, "theme": "auto", "device_id": "d_test00000000" },
  "projects": [],
  "tags": [],
  "tasks": []
}
```

- [ ] **Step 5.2: Write the sample fixture**

Create `src-tauri/tests/fixtures/sample.json`:

```json
{
  "version": 1,
  "settings": { "data_file": null, "theme": "auto", "device_id": "d_test00000000" },
  "projects": [
    { "id": "p_work",     "name": "Work",       "color": "#4338ca" },
    { "id": "p_reno",     "name": "Renovation", "color": "#ef4444" }
  ],
  "tags": [
    { "id": "t_work",     "name": "work",       "color": "#4338ca", "project_id": "p_work" },
    { "id": "t_reno",     "name": "renovation", "color": "#f59e0b", "project_id": "p_reno" },
    { "id": "t_urgent",   "name": "urgent",     "color": "#dc2626" },
    { "id": "t_errand",   "name": "errand",     "color": "#10b981" }
  ],
  "tasks": [
    {
      "id": "k_overdue1", "title": "Reply to Anna", "done": false,
      "due_date": "2026-05-26", "scheduled_date": null, "priority": "high",
      "notes": "", "tag_ids": ["t_work", "t_urgent"],
      "created_at": 1748390000000, "completed_at": null
    },
    {
      "id": "k_today1", "title": "Pick up dry cleaning", "done": false,
      "due_date": null, "scheduled_date": "2026-05-28", "priority": "med",
      "notes": "", "tag_ids": ["t_errand"],
      "created_at": 1748390100000, "completed_at": null
    },
    {
      "id": "k_today2", "title": "Review PR #248", "done": false,
      "due_date": "2026-05-28", "scheduled_date": null, "priority": "high",
      "notes": "", "tag_ids": ["t_work"],
      "created_at": 1748390200000, "completed_at": null
    },
    {
      "id": "k_reno1",  "title": "Call electrician", "done": false,
      "due_date": "2026-05-30", "scheduled_date": "2026-05-28", "priority": "low",
      "notes": "Three-way switch.", "tag_ids": ["t_reno"],
      "created_at": 1748390300000, "completed_at": null
    },
    {
      "id": "k_future1", "title": "Plan vacation", "done": false,
      "due_date": "2026-06-10", "scheduled_date": "2026-06-05", "priority": null,
      "notes": "", "tag_ids": [],
      "created_at": 1748390400000, "completed_at": null
    }
  ]
}
```

This fixture is the **single source of truth** for both Rust and frontend tests. Copy (don't symlink) into `src/tests/fixtures/sample.json` in Task 13.

- [ ] **Step 5.3: Write the failing test**

Create `src-tauri/tests/model_derivations.rs`:

```rust
use chrono::NaiveDate;
use pansutong_lib::model::Document;
use std::fs;

fn load(name: &str) -> Document {
    let path = format!("tests/fixtures/{name}.json");
    let s = fs::read_to_string(&path).unwrap_or_else(|_| panic!("missing fixture {path}"));
    serde_json::from_str(&s).unwrap()
}

fn today() -> NaiveDate { NaiveDate::from_ymd_opt(2026, 5, 28).unwrap() }

#[test]
fn today_view_includes_overdue_scheduled_and_due() {
    let doc = load("sample");
    let ids: Vec<&str> = doc.tasks_today(today()).iter().map(|t| t.id.as_str()).collect();
    assert_eq!(ids, vec!["k_overdue1", "k_today1", "k_today2", "k_reno1"]);
}

#[test]
fn today_view_excludes_future_tasks() {
    let doc = load("sample");
    let ids: Vec<&str> = doc.tasks_today(today()).iter().map(|t| t.id.as_str()).collect();
    assert!(!ids.contains(&"k_future1"));
}

#[test]
fn inbox_contains_only_tagless_or_unprojected_tasks() {
    let doc = load("sample");
    let ids: Vec<&str> = doc.tasks_inbox().iter().map(|t| t.id.as_str()).collect();
    assert_eq!(ids, vec!["k_future1"]);
}

#[test]
fn project_membership_follows_tag_link() {
    let doc = load("sample");
    let work: Vec<&str> = doc.tasks_for_project("p_work").iter().map(|t| t.id.as_str()).collect();
    assert_eq!(work, vec!["k_overdue1", "k_today2"]);
    let reno: Vec<&str> = doc.tasks_for_project("p_reno").iter().map(|t| t.id.as_str()).collect();
    assert_eq!(reno, vec!["k_reno1"]);
}

#[test]
fn tag_lookup_returns_tasks_with_that_tag() {
    let doc = load("sample");
    let urgent: Vec<&str> = doc.tasks_for_tag("t_urgent").iter().map(|t| t.id.as_str()).collect();
    assert_eq!(urgent, vec!["k_overdue1"]);
}

#[test]
fn empty_document_has_empty_derivations() {
    let doc = load("empty");
    assert!(doc.tasks_today(today()).is_empty());
    assert!(doc.tasks_inbox().is_empty());
    assert!(doc.tasks_for_project("p_anything").is_empty());
}
```

- [ ] **Step 5.4: Run the tests — should fail because `pansutong_lib::model` doesn't expose `Document` publicly yet**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test model_derivations`
Expected: compile error — `model` module not declared in `lib.rs` yet.

- [ ] **Step 5.5: Fix lib.rs to expose the module**

Edit `src-tauri/src/lib.rs`. Replace the entire file with:

```rust
pub mod error;
pub mod model;

// `run()` and the rest will be rebuilt in Task 7.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Placeholder — wired up in Task 7.
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 5.6: Run the tests — should now pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test model_derivations`
Expected: 6 passed.

- [ ] **Step 5.7: Commit**

```bash
git add src-tauri/tests/ src-tauri/src/lib.rs
git commit -m "Test model derivations: today, inbox, project, tag lookups"
```

---

## Task 6 — store.rs with atomic writes and hash tracking

**Files:**
- Create: `src-tauri/src/store.rs`

- [ ] **Step 6.1: Write the module**

Create `src-tauri/src/store.rs`:

```rust
use crate::error::{AppError, Result};
use crate::model::Document;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub struct AppState {
    inner: Mutex<Inner>,
}

struct Inner {
    doc: Document,
    path: PathBuf,
    last_written_hash: [u8; 32],
}

impl AppState {
    /// Load `Document` from `path` (or write a default if absent).
    pub fn open(path: PathBuf) -> Result<Self> {
        let (doc, bytes) = if path.exists() {
            let s = fs::read_to_string(&path)?;
            let d: Document = serde_json::from_str(&s)?;
            (d, s.into_bytes())
        } else {
            let d = Document::default();
            let bytes = serde_json::to_vec_pretty(&d)?;
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent)?;
            }
            atomic_write(&path, &bytes)?;
            (d, bytes)
        };
        let hash = sha256(&bytes);
        Ok(Self {
            inner: Mutex::new(Inner { doc, path, last_written_hash: hash }),
        })
    }

    pub fn read<F, T>(&self, f: F) -> T
    where F: FnOnce(&Document) -> T {
        let g = self.inner.lock().unwrap();
        f(&g.doc)
    }

    /// Mutate then persist. Returns the result of `f` after the file is on disk.
    pub fn write<F, T>(&self, f: F) -> Result<T>
    where F: FnOnce(&mut Document) -> Result<T> {
        let mut g = self.inner.lock().unwrap();
        let value = f(&mut g.doc)?;
        let bytes = serde_json::to_vec_pretty(&g.doc)?;
        atomic_write(&g.path, &bytes)?;
        g.last_written_hash = sha256(&bytes);
        Ok(value)
    }

    pub fn path(&self) -> PathBuf {
        self.inner.lock().unwrap().path.clone()
    }

    #[allow(dead_code)] // used by Phase 2 sync
    pub fn last_written_hash(&self) -> [u8; 32] {
        self.inner.lock().unwrap().last_written_hash
    }
}

fn sha256(bytes: &[u8]) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(bytes);
    h.finalize().into()
}

fn atomic_write(target: &Path, bytes: &[u8]) -> Result<()> {
    let tmp = target.with_extension("json.tmp");
    {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
    }
    // On Windows, std::fs::rename replaces atomically since Rust 1.50.
    fs::rename(&tmp, target).map_err(|e| {
        // Clean up tmp on failure; ignore secondary errors.
        let _ = fs::remove_file(&tmp);
        AppError::Io(e)
    })
}
```

- [ ] **Step 6.2: Wire it into lib.rs**

Edit `src-tauri/src/lib.rs`. Replace contents with:

```rust
pub mod error;
pub mod model;
pub mod store;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 6.3: Verify it compiles**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: clean.

- [ ] **Step 6.4: Commit**

```bash
git add src-tauri/src/store.rs src-tauri/src/lib.rs
git commit -m "Add AppState with atomic writes and last-written-hash tracking"
```

---

## Task 7 — Integration test for atomic writes

**Files:**
- Create: `src-tauri/tests/storage_integration.rs`

- [ ] **Step 7.1: Write failing test**

Create `src-tauri/tests/storage_integration.rs`:

```rust
use pansutong_lib::model::{Document, new_task_id, Task};
use pansutong_lib::store::AppState;
use std::fs;
use tempfile::tempdir;

fn make_task(title: &str) -> Task {
    Task {
        id: new_task_id(),
        title: title.into(),
        done: false,
        due_date: None,
        scheduled_date: None,
        priority: None,
        notes: String::new(),
        tag_ids: Vec::new(),
        created_at: 0,
        completed_at: None,
    }
}

#[test]
fn open_creates_default_document_when_missing() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("tasks.json");
    let state = AppState::open(path.clone()).unwrap();
    assert!(path.exists());
    state.read(|d| {
        assert_eq!(d.version, 1);
        assert!(d.tasks.is_empty());
    });
}

#[test]
fn write_persists_and_round_trips() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("tasks.json");
    {
        let state = AppState::open(path.clone()).unwrap();
        state.write(|d| { d.tasks.push(make_task("hello")); Ok(()) }).unwrap();
    }
    let state = AppState::open(path.clone()).unwrap();
    state.read(|d| {
        assert_eq!(d.tasks.len(), 1);
        assert_eq!(d.tasks[0].title, "hello");
    });
}

#[test]
fn atomic_write_leaves_no_tmp_file() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("tasks.json");
    let state = AppState::open(path.clone()).unwrap();
    state.write(|d| { d.tasks.push(make_task("a")); Ok(()) }).unwrap();
    let entries: Vec<_> = fs::read_dir(dir.path()).unwrap()
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().to_string())
        .collect();
    assert!(entries.iter().any(|n| n == "tasks.json"));
    assert!(!entries.iter().any(|n| n.ends_with(".tmp")));
}

#[test]
fn hash_updates_after_write() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("tasks.json");
    let state = AppState::open(path.clone()).unwrap();
    let before = state.last_written_hash();
    state.write(|d| { d.tasks.push(make_task("x")); Ok(()) }).unwrap();
    let after = state.last_written_hash();
    assert_ne!(before, after);
}
```

- [ ] **Step 7.2: Run — should pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test storage_integration`
Expected: 4 passed.

- [ ] **Step 7.3: Commit**

```bash
git add src-tauri/tests/storage_integration.rs
git commit -m "Test atomic write, round-trip, no-tmp-leftover, hash update"
```

---

## Task 8 — commands.rs and full lib.rs wiring

**Files:**
- Create: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 8.1: Write commands.rs**

Create `src-tauri/src/commands.rs`:

```rust
use crate::error::{AppError, Result};
use crate::model::{new_project_id, new_tag_id, new_task_id, Document, Priority, Project, Tag, Task};
use crate::store::AppState;
use chrono::NaiveDate;
use serde::Deserialize;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, State};

const STORE_CHANGED: &str = "store-changed";

fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

fn emit_changed(app: &AppHandle) {
    let _ = app.emit(STORE_CHANGED, ());
}

#[tauri::command]
pub fn get_document(state: State<'_, AppState>) -> Document {
    state.read(|d| d.clone())
}

#[derive(Deserialize)]
pub struct NewTaskInput {
    pub title: String,
    #[serde(default)] pub due_date: Option<NaiveDate>,
    #[serde(default)] pub scheduled_date: Option<NaiveDate>,
    #[serde(default)] pub priority: Option<Priority>,
    #[serde(default)] pub notes: String,
    #[serde(default)] pub tag_ids: Vec<String>,
}

#[tauri::command]
pub fn add_task(input: NewTaskInput, state: State<'_, AppState>, app: AppHandle) -> Result<Task> {
    let title = input.title.trim().to_string();
    if title.is_empty() {
        return Err(AppError::Invalid("title is empty".into()));
    }
    let task = Task {
        id: new_task_id(),
        title,
        done: false,
        due_date: input.due_date,
        scheduled_date: input.scheduled_date,
        priority: input.priority,
        notes: input.notes,
        tag_ids: input.tag_ids,
        created_at: now_ms(),
        completed_at: None,
    };
    let saved = state.write(|d| { d.tasks.push(task.clone()); Ok(task) })?;
    emit_changed(&app);
    Ok(saved)
}

#[derive(Deserialize)]
pub struct UpdateTaskInput {
    pub id: String,
    #[serde(default)] pub title: Option<String>,
    #[serde(default)] pub due_date: Option<Option<NaiveDate>>,
    #[serde(default)] pub scheduled_date: Option<Option<NaiveDate>>,
    #[serde(default)] pub priority: Option<Option<Priority>>,
    #[serde(default)] pub notes: Option<String>,
    #[serde(default)] pub tag_ids: Option<Vec<String>>,
}

#[tauri::command]
pub fn update_task(input: UpdateTaskInput, state: State<'_, AppState>, app: AppHandle) -> Result<Task> {
    let updated = state.write(|d| {
        let t = d.tasks.iter_mut().find(|t| t.id == input.id)
            .ok_or_else(|| AppError::NotFound(format!("task {}", input.id)))?;
        if let Some(v) = input.title          { t.title = v; }
        if let Some(v) = input.due_date       { t.due_date = v; }
        if let Some(v) = input.scheduled_date { t.scheduled_date = v; }
        if let Some(v) = input.priority       { t.priority = v; }
        if let Some(v) = input.notes          { t.notes = v; }
        if let Some(v) = input.tag_ids        { t.tag_ids = v; }
        Ok(t.clone())
    })?;
    emit_changed(&app);
    Ok(updated)
}

#[tauri::command]
pub fn set_task_done(id: String, done: bool, state: State<'_, AppState>, app: AppHandle) -> Result<Task> {
    let updated = state.write(|d| {
        let t = d.tasks.iter_mut().find(|t| t.id == id)
            .ok_or_else(|| AppError::NotFound(format!("task {id}")))?;
        t.done = done;
        t.completed_at = if done { Some(now_ms()) } else { None };
        Ok(t.clone())
    })?;
    emit_changed(&app);
    Ok(updated)
}

#[tauri::command]
pub fn delete_task(id: String, state: State<'_, AppState>, app: AppHandle) -> Result<()> {
    state.write(|d| {
        let before = d.tasks.len();
        d.tasks.retain(|t| t.id != id);
        if d.tasks.len() == before {
            return Err(AppError::NotFound(format!("task {id}")));
        }
        Ok(())
    })?;
    emit_changed(&app);
    Ok(())
}

#[derive(Deserialize)]
pub struct NewProjectInput { pub name: String, pub color: String }

#[tauri::command]
pub fn add_project(input: NewProjectInput, state: State<'_, AppState>, app: AppHandle) -> Result<Project> {
    let p = Project { id: new_project_id(), name: input.name, color: input.color };
    let saved = state.write(|d| { d.projects.push(p.clone()); Ok(p) })?;
    emit_changed(&app);
    Ok(saved)
}

#[tauri::command]
pub fn delete_project(id: String, state: State<'_, AppState>, app: AppHandle) -> Result<()> {
    state.write(|d| {
        let before = d.projects.len();
        d.projects.retain(|p| p.id != id);
        if d.projects.len() == before {
            return Err(AppError::NotFound(format!("project {id}")));
        }
        // Cascade: tags pointing at this project become free-floating.
        for t in d.tags.iter_mut() {
            if t.project_id.as_deref() == Some(&id) { t.project_id = None; }
        }
        Ok(())
    })?;
    emit_changed(&app);
    Ok(())
}

#[derive(Deserialize)]
pub struct NewTagInput {
    pub name: String,
    pub color: String,
    #[serde(default)] pub project_id: Option<String>,
}

#[tauri::command]
pub fn add_tag(input: NewTagInput, state: State<'_, AppState>, app: AppHandle) -> Result<Tag> {
    let t = Tag { id: new_tag_id(), name: input.name, color: input.color, project_id: input.project_id };
    let saved = state.write(|d| { d.tags.push(t.clone()); Ok(t) })?;
    emit_changed(&app);
    Ok(saved)
}

#[tauri::command]
pub fn delete_tag(id: String, state: State<'_, AppState>, app: AppHandle) -> Result<()> {
    state.write(|d| {
        let before = d.tags.len();
        d.tags.retain(|t| t.id != id);
        if d.tags.len() == before {
            return Err(AppError::NotFound(format!("tag {id}")));
        }
        for task in d.tasks.iter_mut() {
            task.tag_ids.retain(|tid| tid != &id);
        }
        Ok(())
    })?;
    emit_changed(&app);
    Ok(())
}
```

- [ ] **Step 8.2: Rewrite lib.rs to wire everything together**

Replace `src-tauri/src/lib.rs` entirely:

```rust
pub mod commands;
pub mod error;
pub mod model;
pub mod store;

use crate::store::AppState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let data_dir = app.path()
                .app_data_dir()
                .expect("app_data_dir resolvable");
            std::fs::create_dir_all(&data_dir).expect("create app data dir");
            let path = data_dir.join("tasks.json");
            let state = AppState::open(path).expect("open store");
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_document,
            commands::add_task,
            commands::update_task,
            commands::set_task_done,
            commands::delete_task,
            commands::add_project,
            commands::delete_project,
            commands::add_tag,
            commands::delete_tag,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 8.3: Verify it compiles**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: clean. Some "unused field" warnings on `AppState::last_written_hash` are expected — they go away in Phase 2 when the sync watcher uses it.

- [ ] **Step 8.4: Run the full test suite to make sure nothing regressed**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: 10 passed (6 from model_derivations + 4 from storage_integration).

- [ ] **Step 8.5: Commit**

```bash
git add src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "Wire commands.rs: get_document, add/update/done/delete task, project, tag"
```

---

## Task 9 — Add frontend dependencies and vitest config

**Files:**
- Modify: `package.json`
- Modify: `tsconfig.json`
- Modify: `vite.config.ts`

- [ ] **Step 9.1: Update package.json**

Open `package.json`. Add to `dependencies`:

```json
"react-router-dom": "^7.0.0"
```

Add to `devDependencies`:

```json
"@testing-library/react": "^16.0.0",
"@types/node": "^22.0.0",
"jsdom": "^25.0.0",
"vitest": "^2.0.0"
```

Add to `scripts`:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 9.2: Update tsconfig.json**

Add `"vitest/globals"` to the `compilerOptions.types` array (create the array if missing):

```json
"types": ["vite/client", "vitest/globals"]
```

- [ ] **Step 9.3: Update vite.config.ts**

Add a `test` block alongside `plugins`:

```ts
test: {
  globals: true,
  environment: "jsdom",
},
```

If `vitest/config` import is needed, change the top of the file to:

```ts
/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
```

- [ ] **Step 9.4: Install**

Run: `npm install`
Expected: completes, no peer-dep errors.

- [ ] **Step 9.5: Sanity-check tests can run**

Run: `npm test`
Expected: vitest reports "No test files found" but exits 0. This confirms the runner works.

- [ ] **Step 9.6: Commit**

```bash
git add package.json package-lock.json tsconfig.json vite.config.ts
git commit -m "Add react-router-dom, vitest, testing-library; configure jsdom"
```

---

## Task 10 — Design tokens and global styles

**Files:**
- Delete: `src/App.css`
- Create: `src/styles/tokens.css`
- Create: `src/styles/global.css`
- Modify: `src/main.tsx`

- [ ] **Step 10.1: Create tokens.css**

Create `src/styles/tokens.css`:

```css
:root {
  /* Type */
  --font-body: -apple-system, "Segoe UI", Inter, Avenir, sans-serif;
  --font-mono: ui-monospace, "Cascadia Mono", Menlo, monospace;

  /* Spacing scale (4px base) */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --space-6: 32px;

  /* Radius */
  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 10px;

  /* Light theme */
  --c-bg:           #f9fafb;
  --c-surface:      #ffffff;
  --c-surface-2:    #f3f4f6;
  --c-border:       #e5e7eb;
  --c-text:         #1f2937;
  --c-text-muted:   #6b7280;
  --c-text-subtle:  #9ca3af;
  --c-accent:       #4338ca;
  --c-accent-bg:    #eef2ff;
  --c-danger:       #dc2626;
  --c-success:      #047857;

  /* Priority stripe */
  --c-pri-high: #ef4444;
  --c-pri-med:  #f59e0b;
  --c-pri-low:  #d1d5db;
}

@media (prefers-color-scheme: dark) {
  :root {
    --c-bg:           #0f172a;
    --c-surface:      #1e293b;
    --c-surface-2:    #243044;
    --c-border:       #334155;
    --c-text:         #e2e8f0;
    --c-text-muted:   #94a3b8;
    --c-text-subtle:  #64748b;
    --c-accent:       #818cf8;
    --c-accent-bg:    #312e81;
    --c-danger:       #fca5a5;
    --c-success:      #6ee7b7;
  }
}
```

- [ ] **Step 10.2: Create global.css**

Create `src/styles/global.css`:

```css
* { box-sizing: border-box; }

html, body, #root {
  margin: 0;
  height: 100%;
}

body {
  font-family: var(--font-body);
  font-size: 14px;
  line-height: 1.5;
  color: var(--c-text);
  background: var(--c-bg);
  -webkit-font-smoothing: antialiased;
}

a { color: var(--c-accent); text-decoration: none; }
a:hover { text-decoration: underline; }

button {
  font: inherit;
  color: inherit;
  background: transparent;
  border: none;
  padding: 0;
  cursor: pointer;
}
```

- [ ] **Step 10.3: Delete App.css**

Run: `git rm src/App.css`

- [ ] **Step 10.4: Update main.tsx imports**

Replace `src/main.tsx`:

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/tokens.css";
import "./styles/global.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

- [ ] **Step 10.5: Commit**

```bash
git add src/styles/ src/main.tsx
git commit -m "Replace App.css with tokens.css + global.css; wire main.tsx"
```

---

## Task 11 — lib/tauri.ts and lib/dates.ts

**Files:**
- Create: `src/lib/tauri.ts`
- Create: `src/lib/dates.ts`

- [ ] **Step 11.1: Write lib/tauri.ts**

Create `src/lib/tauri.ts`:

```ts
import { invoke } from "@tauri-apps/api/core";

export type Priority = "low" | "med" | "high";

export type Settings = {
  data_file: string | null;
  theme: "auto" | "light" | "dark";
  device_id: string;
};

export type Project = { id: string; name: string; color: string };

export type Tag = {
  id: string;
  name: string;
  color: string;
  project_id?: string;
};

export type Task = {
  id: string;
  title: string;
  done: boolean;
  due_date?: string;       // YYYY-MM-DD
  scheduled_date?: string; // YYYY-MM-DD
  priority?: Priority;
  notes: string;
  tag_ids: string[];
  created_at: number;
  completed_at?: number;
};

export type Document = {
  version: number;
  settings: Settings;
  projects: Project[];
  tags: Tag[];
  tasks: Task[];
};

export const api = {
  getDocument:   ()                          => invoke<Document>("get_document"),
  addTask:       (input: Partial<Task> & { title: string }) => invoke<Task>("add_task", { input }),
  updateTask:    (input: Partial<Task> & { id: string })    => invoke<Task>("update_task", { input }),
  setTaskDone:   (id: string, done: boolean) => invoke<Task>("set_task_done", { id, done }),
  deleteTask:    (id: string)                => invoke<void>("delete_task", { id }),
  addProject:    (name: string, color: string) => invoke<Project>("add_project", { input: { name, color } }),
  deleteProject: (id: string)                => invoke<void>("delete_project", { id }),
  addTag:        (name: string, color: string, project_id?: string) =>
                                                invoke<Tag>("add_tag", { input: { name, color, project_id } }),
  deleteTag:     (id: string)                => invoke<void>("delete_tag", { id }),
};
```

- [ ] **Step 11.2: Write lib/dates.ts**

Create `src/lib/dates.ts`:

```ts
/** YYYY-MM-DD in local time. */
export function todayIso(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Compare two ISO date strings lexically — works because format is fixed-width. */
export function isoLt(a: string, b: string): boolean { return a < b; }

/** True if a task with this due date is overdue relative to today. */
export function isOverdue(dueIso: string | undefined, todayIsoStr: string, done: boolean): boolean {
  if (done || !dueIso) return false;
  return isoLt(dueIso, todayIsoStr);
}
```

- [ ] **Step 11.3: Commit**

```bash
git add src/lib/
git commit -m "Add typed Tauri command wrappers and ISO date helpers"
```

---

## Task 12 — state/indexes.ts (derived state in the frontend)

**Files:**
- Create: `src/state/indexes.ts`

- [ ] **Step 12.1: Write the module**

Create `src/state/indexes.ts`:

```ts
import { Document, Project, Tag, Task } from "../lib/tauri";
import { isoLt } from "../lib/dates";

export type Indexes = {
  byProject: Map<string, Task[]>;
  byTag:     Map<string, Task[]>;
  tagToProject: Map<string, string>;
  today:     (todayIso: string) => Task[];
  inbox:     Task[];
  projectsById: Map<string, Project>;
  tagsById:     Map<string, Tag>;
};

export function buildIndexes(doc: Document): Indexes {
  const tagToProject = new Map<string, string>();
  for (const tag of doc.tags) {
    if (tag.project_id) tagToProject.set(tag.id, tag.project_id);
  }

  const byProject = new Map<string, Task[]>();
  const byTag     = new Map<string, Task[]>();
  for (const project of doc.projects) byProject.set(project.id, []);
  for (const tag of doc.tags)         byTag.set(tag.id, []);

  for (const task of doc.tasks) {
    for (const tagId of task.tag_ids) {
      byTag.get(tagId)?.push(task);
      const pid = tagToProject.get(tagId);
      if (pid) byProject.get(pid)?.push(task);
    }
  }

  const inbox = doc.tasks.filter(t =>
    t.tag_ids.every(tid => !tagToProject.has(tid))
  );

  const projectsById = new Map(doc.projects.map(p => [p.id, p]));
  const tagsById     = new Map(doc.tags.map(t => [t.id, t]));

  const today = (todayIso: string): Task[] => doc.tasks.filter(t => {
    if (t.scheduled_date === todayIso) return true;
    if (t.due_date) {
      if (t.due_date === todayIso) return true;
      if (isoLt(t.due_date, todayIso) && !t.done) return true;
    }
    return false;
  });

  return { byProject, byTag, tagToProject, today, inbox, projectsById, tagsById };
}
```

- [ ] **Step 12.2: Copy the Rust fixture for the frontend test**

Run (Windows PowerShell, from project root):

```pwsh
New-Item -ItemType Directory -Force -Path src/tests/fixtures | Out-Null
Copy-Item src-tauri/tests/fixtures/sample.json src/tests/fixtures/sample.json
```

If you prefer Bash:

```bash
mkdir -p src/tests/fixtures
cp src-tauri/tests/fixtures/sample.json src/tests/fixtures/sample.json
```

- [ ] **Step 12.3: Write the failing test**

Create `src/state/indexes.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import sample from "../tests/fixtures/sample.json";
import { Document } from "../lib/tauri";
import { buildIndexes } from "./indexes";

const TODAY = "2026-05-28";

describe("buildIndexes", () => {
  const ix = buildIndexes(sample as unknown as Document);

  it("today contains overdue + scheduled today + due today", () => {
    const ids = ix.today(TODAY).map(t => t.id);
    expect(ids).toEqual(["k_overdue1", "k_today1", "k_today2", "k_reno1"]);
  });

  it("inbox contains only k_future1 (no project-linked tags)", () => {
    expect(ix.inbox.map(t => t.id)).toEqual(["k_future1"]);
  });

  it("byProject for p_work returns the two work tasks", () => {
    expect(ix.byProject.get("p_work")?.map(t => t.id)).toEqual(["k_overdue1", "k_today2"]);
  });

  it("byTag for t_urgent returns one task", () => {
    expect(ix.byTag.get("t_urgent")?.map(t => t.id)).toEqual(["k_overdue1"]);
  });
});
```

- [ ] **Step 12.4: Run the test — should pass**

Run: `npm test`
Expected: 4 passed.

If TypeScript complains about importing JSON, add to `tsconfig.json` under `compilerOptions`:

```json
"resolveJsonModule": true,
"esModuleInterop": true
```

Then re-run.

- [ ] **Step 12.5: Commit**

```bash
git add src/state/ src/tests/ tsconfig.json
git commit -m "Add frontend derived-state indexes with shared JSON fixture"
```

---

## Task 13 — state/store.ts (subscribes to events, exposes useDocument)

**Files:**
- Create: `src/state/store.ts`

- [ ] **Step 13.1: Write the module**

Create `src/state/store.ts`:

```ts
import { useEffect, useMemo, useState } from "react";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { api, Document } from "../lib/tauri";
import { buildIndexes, Indexes } from "./indexes";

type DocState = { doc: Document | null; indexes: Indexes | null; error: string | null };

export function useDocument(): DocState {
  const [doc, setDoc] = useState<Document | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    let unlisten: UnlistenFn | undefined;

    const load = async () => {
      try {
        const d = await api.getDocument();
        if (mounted) setDoc(d);
      } catch (e) {
        if (mounted) setError(String(e));
      }
    };

    void load();
    void listen("store-changed", () => { void load(); }).then(fn => { unlisten = fn; });

    return () => {
      mounted = false;
      unlisten?.();
    };
  }, []);

  const indexes = useMemo(() => (doc ? buildIndexes(doc) : null), [doc]);
  return { doc, indexes, error };
}
```

- [ ] **Step 13.2: Commit**

```bash
git add src/state/store.ts
git commit -m "Add useDocument hook that listens for store-changed"
```

---

## Task 14 — TaskRow and TaskList components

**Files:**
- Create: `src/components/TaskRow.tsx`
- Create: `src/components/TaskList.tsx`

- [ ] **Step 14.1: Write TaskRow.tsx**

Create `src/components/TaskRow.tsx`:

```tsx
import { Task, Tag } from "../lib/tauri";
import { api } from "../lib/tauri";

type Props = {
  task: Task;
  tags: Map<string, Tag>;
  todayIso: string;
};

function priColor(p: Task["priority"]): string {
  switch (p) {
    case "high": return "var(--c-pri-high)";
    case "med":  return "var(--c-pri-med)";
    case "low":  return "var(--c-pri-low)";
    default:     return "transparent";
  }
}

function whenLabel(t: Task, today: string): { text: string; late: boolean } {
  if (t.due_date) {
    if (t.due_date === today)       return { text: "due today", late: false };
    if (t.due_date < today && !t.done) return { text: `−${diffDays(t.due_date, today)}d`, late: true };
    return { text: `due ${t.due_date.slice(5)}`, late: false };
  }
  if (t.scheduled_date === today) return { text: "today", late: false };
  if (t.scheduled_date)           return { text: t.scheduled_date.slice(5), late: false };
  return { text: "", late: false };
}

function diffDays(a: string, b: string): number {
  const da = Date.parse(a), db = Date.parse(b);
  return Math.round((db - da) / 86400000);
}

export function TaskRow({ task, tags, todayIso }: Props) {
  const w = whenLabel(task, todayIso);
  const firstTag = task.tag_ids.length ? tags.get(task.tag_ids[0]) : undefined;

  const toggle = () => { void api.setTaskDone(task.id, !task.done); };
  const remove = () => { void api.deleteTask(task.id); };

  return (
    <div className="task-row" data-done={task.done}>
      <span className="task-pri" style={{ background: priColor(task.priority) }} />
      <input type="checkbox" checked={task.done} onChange={toggle} aria-label={`Toggle ${task.title}`} />
      <span className="task-title">{task.title}</span>
      {firstTag && (
        <span className="task-tag" style={{ background: firstTag.color + "22", color: firstTag.color }}>
          {firstTag.name}
        </span>
      )}
      {w.text && <span className={w.late ? "task-when late" : "task-when"}>{w.text}</span>}
      <button className="task-delete" onClick={remove} aria-label={`Delete ${task.title}`}>×</button>
    </div>
  );
}
```

- [ ] **Step 14.2: Add component styles**

Append to `src/styles/global.css`:

```css
.task-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--radius-md);
  padding: var(--space-2) var(--space-3);
  margin-bottom: var(--space-1);
  font-size: 0.92rem;
}
.task-row[data-done="true"] .task-title { color: var(--c-text-subtle); text-decoration: line-through; }
.task-pri   { width: 3px; height: 18px; border-radius: 2px; flex-shrink: 0; }
.task-title { flex: 1; word-break: break-word; }
.task-tag   { font-size: 0.7rem; padding: 1px 6px; border-radius: 3px; font-weight: 600; }
.task-when  { color: var(--c-text-muted); font-size: 0.72rem; font-variant-numeric: tabular-nums; }
.task-when.late { color: var(--c-danger); font-weight: 600; }
.task-delete { color: var(--c-text-subtle); font-size: 1.2rem; padding: 0 var(--space-1); }
.task-delete:hover { color: var(--c-danger); }
```

- [ ] **Step 14.3: Write TaskList.tsx**

Create `src/components/TaskList.tsx`:

```tsx
import { Task, Tag } from "../lib/tauri";
import { TaskRow } from "./TaskRow";

type Props = {
  tasks: Task[];
  tags: Map<string, Tag>;
  todayIso: string;
  emptyText?: string;
};

export function TaskList({ tasks, tags, todayIso, emptyText = "Nothing here." }: Props) {
  if (tasks.length === 0) return <p className="task-empty">{emptyText}</p>;
  return (
    <div>
      {tasks.map(t => <TaskRow key={t.id} task={t} tags={tags} todayIso={todayIso} />)}
    </div>
  );
}
```

Append to `global.css`:

```css
.task-empty { color: var(--c-text-subtle); text-align: center; padding: var(--space-6) 0; }
```

- [ ] **Step 14.4: Commit**

```bash
git add src/components/ src/styles/global.css
git commit -m "Add TaskRow and TaskList components matching dense visual"
```

---

## Task 15 — Composer (plain add-task input)

**Files:**
- Create: `src/components/Composer.tsx`

- [ ] **Step 15.1: Write the component**

Create `src/components/Composer.tsx`:

```tsx
import { FormEvent, useState } from "react";
import { api } from "../lib/tauri";

type Props = { scheduledDate?: string };

export function Composer({ scheduledDate }: Props) {
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const t = title.trim();
    if (!t) return;
    try {
      await api.addTask({ title: t, scheduled_date: scheduledDate });
      setTitle("");
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  };

  return (
    <form className="composer" onSubmit={submit}>
      <input
        value={title}
        onChange={e => setTitle(e.currentTarget.value)}
        placeholder="What needs doing?"
        aria-label="New task"
      />
      <button type="submit">Add</button>
      {error && <p className="composer-error">{error}</p>}
    </form>
  );
}
```

- [ ] **Step 15.2: Styles**

Append to `global.css`:

```css
.composer {
  display: flex;
  gap: var(--space-2);
  margin-bottom: var(--space-3);
}
.composer input {
  flex: 1;
  background: var(--c-surface);
  color: var(--c-text);
  border: 1px solid var(--c-border);
  border-radius: var(--radius-md);
  padding: var(--space-2) var(--space-3);
  outline: none;
}
.composer input:focus { border-color: var(--c-accent); box-shadow: 0 0 0 2px var(--c-accent-bg); }
.composer button {
  background: var(--c-accent);
  color: white;
  border-radius: var(--radius-md);
  padding: var(--space-2) var(--space-4);
}
.composer-error { color: var(--c-danger); margin: var(--space-1) 0 0; font-size: 0.85rem; flex-basis: 100%; }
```

- [ ] **Step 15.3: Commit**

```bash
git add src/components/Composer.tsx src/styles/global.css
git commit -m "Add plain Composer component (smart-parse deferred to Phase 2)"
```

---

## Task 16 — DesktopShell and Sidebar

**Files:**
- Create: `src/shell/DesktopShell.tsx`
- Create: `src/shell/Sidebar.tsx`

- [ ] **Step 16.1: Write Sidebar.tsx**

Create `src/shell/Sidebar.tsx`:

```tsx
import { NavLink } from "react-router-dom";
import { Document } from "../lib/tauri";
import { Indexes } from "../state/indexes";
import { todayIso } from "../lib/dates";

type Props = { doc: Document; indexes: Indexes };

export function Sidebar({ doc, indexes }: Props) {
  const today = todayIso();
  const todayCount = indexes.today(today).length;
  const inboxCount = indexes.inbox.length;

  return (
    <nav className="sidebar">
      <ul className="sidebar-list">
        <li>
          <NavLink to="/today" className={({ isActive }) => isActive ? "sidebar-link active" : "sidebar-link"}>
            Today <span className="sidebar-count">{todayCount}</span>
          </NavLink>
        </li>
        <li>
          <NavLink to="/inbox" className={({ isActive }) => isActive ? "sidebar-link active" : "sidebar-link"}>
            Inbox <span className="sidebar-count">{inboxCount}</span>
          </NavLink>
        </li>
      </ul>

      {doc.projects.length > 0 && (
        <>
          <div className="sidebar-section">Projects</div>
          <ul className="sidebar-list">
            {doc.projects.map(p => (
              <li key={p.id}>
                <NavLink to={`/project/${p.id}`} className={({ isActive }) => isActive ? "sidebar-link active" : "sidebar-link"}>
                  <span className="sidebar-dot" style={{ background: p.color }} />
                  {p.name}
                  <span className="sidebar-count">{indexes.byProject.get(p.id)?.length ?? 0}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </>
      )}

      {doc.tags.length > 0 && (
        <>
          <div className="sidebar-section">Tags</div>
          <ul className="sidebar-list">
            {doc.tags.filter(t => !t.project_id).map(t => (
              <li key={t.id}>
                <NavLink to={`/tag/${t.id}`} className={({ isActive }) => isActive ? "sidebar-link active" : "sidebar-link"}>
                  #{t.name}
                </NavLink>
              </li>
            ))}
          </ul>
        </>
      )}
    </nav>
  );
}
```

Note: the `/project/:id` and `/tag/:id` routes don't exist yet — they're Phase 2. The links render, but clicking them shows the router's no-match component.

- [ ] **Step 16.2: Write DesktopShell.tsx**

Create `src/shell/DesktopShell.tsx`:

```tsx
import { ReactNode } from "react";
import { Document } from "../lib/tauri";
import { Indexes } from "../state/indexes";
import { Sidebar } from "./Sidebar";

type Props = { doc: Document; indexes: Indexes; children: ReactNode };

export function DesktopShell({ doc, indexes, children }: Props) {
  return (
    <div className="desktop-shell">
      <Sidebar doc={doc} indexes={indexes} />
      <main className="desktop-main">{children}</main>
    </div>
  );
}
```

- [ ] **Step 16.3: Styles**

Append to `global.css`:

```css
.desktop-shell { display: grid; grid-template-columns: 220px 1fr; height: 100%; }

.sidebar {
  background: var(--c-surface-2);
  border-right: 1px solid var(--c-border);
  padding: var(--space-3) var(--space-2);
  overflow-y: auto;
}
.sidebar-list { list-style: none; padding: 0; margin: 0 0 var(--space-3); }
.sidebar-section {
  text-transform: uppercase;
  font-size: 0.65rem;
  letter-spacing: 0.06em;
  color: var(--c-text-muted);
  font-weight: 600;
  padding: var(--space-2) var(--space-2) var(--space-1);
}
.sidebar-link {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-sm);
  color: var(--c-text);
  font-size: 0.88rem;
}
.sidebar-link:hover { background: var(--c-surface); text-decoration: none; }
.sidebar-link.active { background: var(--c-accent-bg); color: var(--c-accent); font-weight: 600; }
.sidebar-count { margin-left: auto; font-size: 0.72rem; color: var(--c-text-subtle); }
.sidebar-dot { width: 8px; height: 8px; border-radius: 50%; }

.desktop-main {
  padding: var(--space-5) var(--space-6);
  overflow-y: auto;
}
```

- [ ] **Step 16.4: Commit**

```bash
git add src/shell/ src/styles/global.css
git commit -m "Add DesktopShell + Sidebar with Today/Inbox/Projects/Tags links"
```

---

## Task 17 — TodayView and InboxView

**Files:**
- Create: `src/views/TodayView.tsx`
- Create: `src/views/InboxView.tsx`

- [ ] **Step 17.1: Write TodayView.tsx**

Create `src/views/TodayView.tsx`:

```tsx
import { Composer } from "../components/Composer";
import { TaskList } from "../components/TaskList";
import { Document } from "../lib/tauri";
import { Indexes } from "../state/indexes";
import { todayIso } from "../lib/dates";

type Props = { doc: Document; indexes: Indexes };

export function TodayView({ doc, indexes }: Props) {
  const today = todayIso();
  const tasks = indexes.today(today);
  return (
    <section>
      <header className="view-header">
        <h1>Today</h1>
        <p className="view-sub">{today} · {tasks.length} task{tasks.length === 1 ? "" : "s"}</p>
      </header>
      <Composer scheduledDate={today} />
      <TaskList tasks={tasks} tags={indexes.tagsById} todayIso={today}
                emptyText="No tasks scheduled or due today." />
    </section>
  );
}
```

- [ ] **Step 17.2: Write InboxView.tsx**

Create `src/views/InboxView.tsx`:

```tsx
import { Composer } from "../components/Composer";
import { TaskList } from "../components/TaskList";
import { Document } from "../lib/tauri";
import { Indexes } from "../state/indexes";
import { todayIso } from "../lib/dates";

type Props = { doc: Document; indexes: Indexes };

export function InboxView({ doc, indexes }: Props) {
  const tasks = indexes.inbox;
  return (
    <section>
      <header className="view-header">
        <h1>Inbox</h1>
        <p className="view-sub">Tasks without a project</p>
      </header>
      <Composer />
      <TaskList tasks={tasks} tags={indexes.tagsById} todayIso={todayIso()}
                emptyText="Inbox is empty." />
    </section>
  );
}
```

- [ ] **Step 17.3: Styles for view headers**

Append to `global.css`:

```css
.view-header { margin-bottom: var(--space-4); }
.view-header h1 { margin: 0 0 var(--space-1); font-size: 1.5rem; letter-spacing: -0.02em; }
.view-sub { color: var(--c-text-muted); margin: 0; font-size: 0.85rem; }
```

- [ ] **Step 17.4: Commit**

```bash
git add src/views/ src/styles/global.css
git commit -m "Add TodayView and InboxView"
```

---

## Task 18 — Replace App.tsx with router

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 18.1: Replace App.tsx**

Replace `src/App.tsx` entirely:

```tsx
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { DesktopShell } from "./shell/DesktopShell";
import { TodayView } from "./views/TodayView";
import { InboxView } from "./views/InboxView";
import { useDocument } from "./state/store";

export default function App() {
  const { doc, indexes, error } = useDocument();

  if (error) return <p className="app-error">Failed to load: {error}</p>;
  if (!doc || !indexes) return <p className="app-loading">Loading…</p>;

  return (
    <BrowserRouter>
      <DesktopShell doc={doc} indexes={indexes}>
        <Routes>
          <Route path="/" element={<Navigate to="/today" replace />} />
          <Route path="/today" element={<TodayView doc={doc} indexes={indexes} />} />
          <Route path="/inbox" element={<InboxView doc={doc} indexes={indexes} />} />
          <Route path="*"      element={<p>Not built yet — comes in Phase 2.</p>} />
        </Routes>
      </DesktopShell>
    </BrowserRouter>
  );
}
```

- [ ] **Step 18.2: Loading/error styles**

Append to `global.css`:

```css
.app-loading, .app-error {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--c-text-muted);
}
.app-error { color: var(--c-danger); }
```

- [ ] **Step 18.3: Type-check the frontend**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 18.4: Run tests one more time**

Run: `npm test` and `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: all green.

- [ ] **Step 18.5: Commit**

```bash
git add src/App.tsx src/styles/global.css
git commit -m "Replace App.tsx with router; mount TodayView and InboxView"
```

---

## Task 19 — Smoke test the running app

**Files:** none (manual verification)

- [ ] **Step 19.1: Launch dev mode**

Run: `npm run tauri dev`
Expected: Vite compiles, Rust compiles (slow first time), a window opens titled "Pansutong" showing the Today view with the sidebar.

- [ ] **Step 19.2: Add a task**

In the composer, type `Buy milk` and press Enter.
Expected: task appears in Today (since `scheduledDate=today`). Sidebar Today count goes to 1.

- [ ] **Step 19.3: Toggle done**

Click the checkbox. Title should strike through.

- [ ] **Step 19.4: Switch to Inbox**

Click "Inbox" in the sidebar.
Expected: blank list ("Inbox is empty.") because the task was scheduled.

- [ ] **Step 19.5: Add an inbox task**

In the Inbox composer, type `Unscheduled thought` and press Enter.
Expected: task appears.

- [ ] **Step 19.6: Quit and relaunch — persistence check**

Close the window. Run `npm run tauri dev` again.
Expected: both tasks are still there. Open Today → `Buy milk` is still listed.

- [ ] **Step 19.7: Find the JSON on disk and inspect**

Run: `Get-Content "$env:APPDATA\net.puetsua.pansutong\tasks.json"`
Expected: a JSON document with the two tasks, matching the Section 2 schema.

- [ ] **Step 19.8: Commit nothing — this task is verification only**

If everything works, the plan is complete. If anything fails, add a follow-up task before moving to Phase 2.

---

## Phase 1 done

You now have:

- A modular Rust core (`error`, `model`, `store`, `commands`).
- A typed frontend with `useDocument`, derived indexes, router, sidebar, two views.
- Atomic writes with a populated `last_written_hash` ready for the Phase 2 watcher.
- A shared test fixture used by `cargo test` (model + storage) and `vitest` (indexes).
- A working desktop app: add/complete/delete tasks, switch between Today and Inbox, persistence across restarts.

**Next plan:** `docs/superpowers/plans/<date>-pansutong-phase-2-sync-and-views.md` — adds the watcher + conflict UI, the Project/Tag/Upcoming/Search/Settings views, and the smart-parse composer grammar.
