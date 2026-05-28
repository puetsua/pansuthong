# Pansutong — Design

**Date:** 2026-05-28
**Status:** approved (pending user spec review)
**Stack:** Tauri 2 · Rust · React + TypeScript · Vite

## What it is

Pansutong is a single-user, cross-platform task tracker that runs on Windows desktop and Android from one codebase. Tasks live in a single JSON file that the user syncs between devices with **Syncthing**. No accounts, no cloud, no servers. Today view is the home screen.

Use case: a unified "life + work hub" — quick personal todos and structured work tasks in the same app.

## Decisions captured during brainstorming

| Topic | Decision |
|---|---|
| Use case | Unified life + work hub |
| Sync mechanism | File sync via Syncthing (single JSON file on user-chosen path) |
| Organization | Projects (first-class), global tags. Each tag may optionally link to one project. |
| Project ↔ tag direction | **Tag carries the link** (`Tag.project_id`). Projects don't own tag lists. |
| Today view | Scheduled-for-today + overdue + due-today |
| Task fields (v1) | Title, done, due_date, scheduled_date, priority, notes (markdown) |
| Visual direction | Dense / informative (Todoist-like): priority stripe, project tag, dates always visible |
| Layout | Platform-native: sidebar on desktop, bottom tabs on Android |
| Data layer | Single JSON file + filesystem watcher + last-write-wins, conflict files surfaced in UI |
| v1 advanced features | Search, quick-capture shortcut |
| Out of v1 | Subtasks, recurring, time-of-day, CRDT, reminders, multi-user (see `docs/superpowers/backlog.md`) |

## Architecture

```
┌──────────────────── Pansutong (Tauri 2 app) ───────────────────────┐
│                                                                     │
│  ┌── Frontend (React + TS, runs in Tauri webview) ───────────────┐ │
│  │  Routes (react-router):                                        │ │
│  │    /today (default)  /inbox  /upcoming                         │ │
│  │    /project/:id      /tag/:name                                │ │
│  │    /search           /settings           /conflicts            │ │
│  │                                                                │ │
│  │  Shell adapts: sidebar on desktop, bottom tab bar on Android   │ │
│  │  (CSS media query + tauri::os check for native polish).        │ │
│  │                                                                │ │
│  │  Comm with Rust:                                               │ │
│  │   • invoke<T>("cmd", args)  — commands                         │ │
│  │   • listen("store-changed") — events from watcher              │ │
│  │   • listen("conflicts-detected")                               │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                            ↕                                        │
│  ┌── Rust core (src-tauri/src/) ─────────────────────────────────┐ │
│  │  store      — load/save tasks.json (atomic: tmp + rename)     │ │
│  │  sync       — notify watcher (desktop) / poll (Android),      │ │
│  │               loop-suppression via sha256, conflict scan      │ │
│  │  search     — in-memory substring match on title + notes      │ │
│  │  capture    — global hotkey (desktop) + share intent (Android)│ │
│  │  commands   — invoke handlers (list/add/update/complete…)     │ │
│  │  parse      — composer grammar (#tag, due X, sched X, !!!)    │ │
│  │  model      — Task, Project, Tag, Document, derived state     │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                            ↕                                        │
│  ┌── tasks.json — single source of truth ─────────────────────────┐ │
│  │  Lives at user-configurable path (default: app_data_dir).      │ │
│  │  User points it at their Syncthing folder in Settings.         │ │
│  │  External edits picked up by watcher → frontend re-renders.    │ │
│  └────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

**Single state owner:** Rust holds the canonical in-memory state; the frontend is a view. All mutations go: frontend `invoke` → Rust mutates + writes JSON atomically + emits `store-changed`. External writes go: watcher detects → Rust reloads + emits `store-changed`. One code path for all UI refreshes.

## Data model

### Document shape (`tasks.json`)

```jsonc
{
  "version": 1,
  "settings": {
    "data_file": "C:/Users/hank/SyncFolder/pansutong/tasks.json",
    "theme": "auto",            // "auto" (OS prefers-color-scheme) | "light" | "dark"
    "device_id": "win-hank-1"   // stamped on writes; used by conflict UI
  },
  "projects": [
    { "id": "p_8f3kqx", "name": "Home Renovation", "color": "#ef4444" }
  ],
  "tags": [
    { "id": "t_renovation", "name": "renovation", "color": "#f59e0b",
      "project_id": "p_8f3kqx" },
    { "id": "t_work",       "name": "work",       "color": "#4338ca",
      "project_id": "p_work" },
    { "id": "t_urgent",     "name": "urgent",     "color": "#dc2626"
      /* no project_id — free-floating global tag */ }
  ],
  "tasks": [
    {
      "id": "k_2pq71a",
      "title": "Call electrician",
      "done": false,
      "due_date":       "2026-05-30",
      "scheduled_date": "2026-05-28",
      "priority": "low",
      "notes": "Ask about three-way switch in the hallway.",
      "tag_ids": ["t_renovation"],
      "created_at":   1748390400000,
      "completed_at": null
    }
  ]
}
```

### Field decisions

| Field/Concern | Choice | Rationale |
|---|---|---|
| IDs | Short random strings prefixed `k_` (task), `p_` (project), `t_` (tag) | Stable across devices, no central counter, prefix tells you the type at a glance, easy to grep. |
| Dates | ISO `YYYY-MM-DD`, no time-of-day | Times live in notes for v1; can add `due_at` later as non-breaking migration. |
| Tag → project link | `Tag.project_id` (optional, ≤1 project) | Matches "tags link tasks to projects." Projects don't keep tag lists. |
| Project membership | **Derived** — task in project P if any tag has `project_id == P.id` | Single source of truth: tags. No mutation can drift. |
| Inbox | **Derived** — task has no tag with a non-null `project_id` | No explicit "inbox" flag. |
| Today | **Derived** — `scheduled == today` OR (`due < today` AND `!done`) OR `due == today` | One query, used by the home screen. |
| Soft delete | None — delete is hard | YAGNI; recover from sync history if needed. |
| Schema versioning | `version: 1` at root | Lets migrations detect-and-upgrade in place. |
| `device_id` | Stamped on writes | Sets up the conflict-resolve UI without committing to it yet. |

### Frontend derived indexes

Built on every `store-changed` event from pure functions of `Document`:

- `byProject: Map<projectId, Task[]>`
- `byTag: Map<tagId, Task[]>`
- `today: Task[]`
- `inbox: Task[]`
- `tagToProject: Map<tagId, projectId>` (lookup helper for `byProject`)

### Cascading rules

- **Delete a project** → cascades to setting `project_id = null` on all tags that referenced it. Tags themselves remain.
- **Delete a tag** → removed from all `tasks[].tag_ids`. Tasks remain.
- **Validation on save** — a tag's `project_id` must exist; orphan refs cleaned silently on load.

## Sync & conflict handling

Sync model: file sync via **Syncthing** between Windows and Android. The file format and atomic-write discipline make this safe.

### Atomic writes

```
1. Serialize state to bytes
2. Write to    <data_file>.tmp
3. fsync(tmp)
4. Atomic rename tmp → <data_file>
   (Windows: MoveFileEx with REPLACE_EXISTING; Android: rename(2))
5. Record: last_written_hash = sha256(bytes), last_written_at = now
```

Atomic on NTFS (Windows 10+) and ext4/F2FS (Android). Syncthing never picks up partial files.

### Watcher (desktop)

- `notify` crate v6+.
- **Watches the parent directory, not the file** — atomic-rename creates a new inode; watching the path misses post-rename events.
- 250 ms debounce window.
- **Loop suppression:** on every event, compute `sha256(file)`. If equal to `last_written_hash`, ignore (own write echoing back). Otherwise: external edit → reload + emit `store-changed`.

### Watcher (Android)

- `notify` doesn't work over SAF URIs.
- Poll `sha256(file)` every ~3s while the window is foregrounded.
- Same loop-suppression logic; same downstream behavior.

### External reload path

```
event fired
  → sha256(file) ≠ last_written_hash ?
    yes → read & parse:
            • parse OK  → swap state, emit `store-changed`
            • parse fail → leave state alone, surface toast
    no  → ignore
```

No diff/merge logic at this layer — last-write-wins within a single device's view. Real cross-device conflicts are handled via conflict files (below).

### Sync-conflict file detection

Syncthing keeps the losing version as a sibling: `tasks.sync-conflict-20260528-123045-7AB2C9D.json`.

- On every watcher event, scan the parent directory for siblings matching `<stem>*conflict*.json` (case-insensitive).
- Emit `conflicts-detected` with the file list.
- Frontend shows a persistent banner: **"1 sync conflict — review"**.

### Conflict-resolve UI

A `/conflicts` view, one screen per conflict file. Diff is per-task by `id`:

```
3 tasks differ between yours and theirs:

◐  "Reply to Anna"
   yours:  done · scheduled 5/28
   theirs: not done · scheduled 5/29
   [Keep mine]  [Keep theirs]  [Keep both]

◐  "Review PR #248"                  (only on yours)
   [Keep]  [Drop]

◐  "Call dentist"                    (only on theirs)
   [Add to mine]  [Ignore]

─────────────────────────────────────
Or:  [Use all mine]   [Use all theirs]

When done → writes merged result, deletes conflict file.
```

Project/tag differences are hidden behind a "show metadata differences" toggle (rarely change).

### Android storage notes

- **Default location:** `app_data_dir()` — app-private, no permission.
- **For Syncthing:** user picks a folder via Android folder-picker (SAF). The app stores the resulting URI in `settings.data_file` and uses `tauri-plugin-fs` for I/O on that platform.

## Quick capture

### Desktop (Windows)

- Default hotkey: **`Ctrl+Shift+N`** (configurable). Registered via `tauri-plugin-global-shortcut`.
- Opens an always-on-top **separate webview window** (`quick-capture/index.html`), ~480×120, decorationless.
- One input field; smart-parse inline:
  - `#tagname` → applies tag (auto-creates if missing)
  - `due tomorrow` / `due 5/30` / `due fri` → sets `due_date`
  - `sched today` / `sched mon` → sets `scheduled_date`
  - leading `!` / `!!` / `!!!` → low / med / high priority
- Captured task lands in **Inbox** unless input says otherwise.
- Enter saves & closes; Shift+Enter saves & clears (rapid-fire); Esc cancels.

### Android

- **Share target** (`<intent-filter action="SEND" mimeType="text/plain">`) — system share sheet → "Pansutong" → composer opens with pre-filled text.
- **Home-screen widget** (`AppWidgetProvider`) — 1×1 "+ Add task" tap → opens app directly to composer.
- Both feed the same Rust `add_task` command. Same smart-parse rules.

### Cross-cutting

- **One `add_task` command** shared by hotkey, share intent, widget, and main-app composer.
- **Tag auto-creation** on unknown `#word` removes the "create tag first" step. Newly auto-created tags get `project_id = null` and a color picked round-robin from a small built-in palette.

## Project structure

```
pansutong/
├── src-tauri/src/             Rust core
│   ├── main.rs                Desktop entry → pansutong_lib::run()
│   ├── lib.rs                 #[cfg_attr(mobile, tauri::mobile_entry_point)] run()
│   ├── model.rs               Task, Project, Tag, Document, IDs, derived state
│   ├── store.rs               AppState (Mutex<Document>), atomic load/save, hash tracking
│   ├── sync.rs                notify watcher / Android poll, loop-suppression, conflict scan
│   ├── parse.rs               Composer grammar
│   ├── search.rs              Substring search
│   ├── capture.rs             #[cfg(desktop)] hotkey; #[cfg(target_os="android")] share intent
│   ├── commands.rs            All #[tauri::command] handlers
│   └── error.rs               AppError
│
├── src-tauri/capabilities/
│   ├── default.json
│   └── capture.json           Permissions for the capture window
│
├── src-tauri/gen/android/     Generated by `tauri android init` — checked in
│
└── src/                       Frontend
    ├── main.tsx
    ├── App.tsx                Router + DesktopShell vs MobileShell selection
    ├── styles/
    │   ├── tokens.css         Design tokens — single source for colors/spacing/radii
    │   └── global.css
    ├── shell/
    │   ├── DesktopShell.tsx   Sidebar + main pane
    │   ├── MobileShell.tsx    Bottom tabs + main pane
    │   ├── Sidebar.tsx
    │   └── BottomTabs.tsx
    ├── views/
    │   ├── TodayView.tsx
    │   ├── InboxView.tsx
    │   ├── UpcomingView.tsx
    │   ├── ProjectView.tsx
    │   ├── TagView.tsx
    │   ├── SearchView.tsx
    │   ├── SettingsView.tsx
    │   └── ConflictsView.tsx
    ├── components/
    │   ├── TaskList.tsx
    │   ├── TaskRow.tsx        Dense row from mockup B
    │   ├── Composer.tsx
    │   ├── DatePicker.tsx
    │   ├── PrioritySelector.tsx
    │   └── TagChip.tsx
    ├── quick-capture/
    │   ├── index.html         Separate Tauri window entry
    │   └── QuickCapture.tsx
    ├── state/
    │   ├── store.ts           Subscribes to store-changed, calls commands
    │   ├── indexes.ts         Memoized derived indexes
    │   └── parse.ts           Mirror of Rust parse.rs (client-side preview)
    └── lib/
        ├── tauri.ts           Typed wrappers around invoke<T>
        └── dates.ts           ISO date helpers
```

### Boundary rules

| Boundary | Rule |
|---|---|
| Rust ↔ frontend | Only via `invoke<T>` and `listen`. Frontend never touches the filesystem. |
| `model.rs` | Pure data + pure derivations. No I/O. No Tauri imports. Unit-testable. |
| `store.rs` | The only module that opens files. Holds canonical state. |
| `sync.rs` | The only module that runs background tasks. Emits events; never mutates. |
| `commands.rs` | Thin wrappers: validate → call store → return. No business logic. |
| `views/*` | Read derived indexes from `state/indexes.ts`. Never call `invoke` directly. |
| `tokens.css` | The only place colors/spacing/radii are defined. |
| Platform-specific code | Behind `#[cfg(desktop)]` / `#[cfg(target_os="android")]` on Rust side; behind `usePlatform()` on TS side. No leakage. |

### Two HTML entries

Quick-capture window is a separate Tauri WebviewWindow with its own root HTML — keeps the bundle small (no router, no shell), opens instantly. Vite multi-entry build: `index.html` + `quick-capture/index.html`.

### How the existing scaffold becomes this

| Now | Becomes |
|---|---|
| `src-tauri/src/lib.rs` (single file) | Split into `model.rs`, `store.rs`, `commands.rs` |
| `src/App.tsx` (single-screen task list) | `views/TodayView.tsx` |
| `src/App.css` | `styles/tokens.css` + `styles/global.css` + co-located component styles |

## Testing

| Layer | Coverage | Tool |
|---|---|---|
| `model.rs` derived state (today / inbox / project membership) | Unit tests with JSON fixtures | `cargo test` |
| `parse.rs` composer grammar (#tag, due X, sched X, !!!) | Unit tests per case, including ambiguous date phrases (`due fri` = next occurrence of Friday) | `cargo test` |
| `store.rs` atomic write + hash suppression | Integration test using `tempfile` | `cargo test` |
| `sync.rs` conflict-file detection | Integration test with planted siblings | `cargo test` |
| Frontend logic (`state/indexes.ts`, `state/parse.ts`) | Vitest, same JSON fixtures as Rust | `vitest` |
| End-to-end | Manual smoke test for v1 (boot, add, restart, persists) | Manual |

**Shared fixtures:** `tests/fixtures/*.json` is consumed by both `cargo test` and `vitest`. If a derivation diverges between Rust and TS, both suites fail.

**Not testing:** React snapshot tests, Tauri command plumbing, Android-specific code paths in CI.

## Out of scope for v1

Captured in `docs/superpowers/backlog.md` with rationale for each.

In short: no subtasks, no recurring tasks, no time-of-day on dates, no CRDT auto-merge, no reminders, no multi-user/sharing, no background Android sync (Syncthing handles it), no history/audit view, no theme beyond `auto/light/dark`, no foreground-service Android capture.

## Open items for the implementation plan

These are decisions the spec leaves to the plan stage (no architectural impact):

- Concrete crate choices: `notify`, `serde`, `chrono` (vs `time`), `sha2`, `tempfile`, `tauri-plugin-global-shortcut`, `tauri-plugin-fs`.
- React router choice (`react-router` vs hand-rolled tiny matcher).
- Test-fixture format & loader.
- Exact wording / pixel polish of the conflict UI and quick-capture composer.
- Whether `device_id` is auto-generated or user-configurable on first launch.
