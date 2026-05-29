# Pansutong Phase 4B — Android Folder Sync (SAF) Design

**Status:** Approved (brainstorming complete) — ready for implementation planning.
**Scope:** Android only. Desktop sync is unchanged.

## Goal

Let an Android user point Pansutong at a **Syncthing-managed folder** so their tasks sync across devices, **without** giving up the crash-safety, change-detection, and conflict handling the desktop path already has. The phone becomes a real sync participant instead of a local-only client.

## Context (current state)

- The app stores a single JSON document. `store.rs` masters `app_data_dir()/tasks.json` with atomic temp+fsync+rename writes and a `last_written_hash` for loop-suppression. `sync.rs` runs a `notify` watcher; `conflict.rs` + the conflict commands scan the data-file's **directory** for `*.sync-conflict-*` (Syncthing) / Dropbox conflict files and resolve them via `diff_tasks`/`apply_decisions`, surfaced in `ConflictsView` (Phase 2-sync).
- On Android today the app is **local-only** (app-private storage); the watcher/conflict scanner run but only against unreachable app-private storage.
- `Settings.data_file: Option<String>` exists but is **currently unused**. `update_settings` currently only accepts `theme`.
- All persistence I/O is POSIX-path-based.

## Feasibility findings (from research — see Citations)

Verdict: **needs a community plugin.** This is a deliberate phase, not a quick add.

- **Official Tauri 2 has no Android folder picker.** `tauri-plugin-dialog` cannot pick a directory on Android ([plugins-workspace#933](https://github.com/tauri-apps/plugins-workspace/issues/933), open since Feb 2024); `tauri-plugin-fs` cannot `readDir`/`createFile` inside a SAF tree or persist URI permissions. Only single-file open/save pickers work officially.
- **`tauri-plugin-android-fs` (aiueo13)** is the practical option: `pick_dir`, `take_persistable_uri_permission` / `check_persisted_uri_permission`, `read_dir`, `create_new_file`, `open_file_readable`/`open_file_writable`. It is **Rust-only** (custom `invoke` commands needed) and **single-maintainer** — a dependency risk we accept by **pinning the version and isolating it behind one module**.
- **SAF has no atomic temp+rename.** Safe SAF writes are overwrite-in-place using ContentResolver mode `"rwt"` (never `"w"`, which stopped truncating on Android 10+ and can corrupt shorter files). A mid-write crash can leave a torn file in the synced folder. We mitigate by **keeping the real, crash-safe master in app-private storage** (the SAF copy is recoverable from it).
- **`notify` does not work on `content://` URIs.** Change detection over SAF means polling/foreground checks (we deliberately avoid timed background polling — see Data Flow).
- **Conflict scanning must be reachable.** `fs::read_dir` can't enumerate a content tree, but SAF `read_dir` can list `*.sync-conflict-*` names (slow, per-entry IPC, can return incomplete results while a provider is still loading).
- **Persisted URI grants are capped** (128 pre-Android 11, 512 after); persisting **one tree URI per root folder** stays well within limits.

## Decisions captured during brainstorming

| Topic | Decision |
|---|---|
| Direction | SAF folder + lightweight sync (NOT full background polling; NOT manual-only import/export; NOT deferral) |
| Source of truth | App-private `tasks.json` stays master ("shadow"); picked folder is a **mirror** |
| Storage layer | **Unchanged** — no `StorageBackend` rewrite of `store.rs`. A new peripheral `safsync` module mirrors files. |
| Sync trigger | **Auto push-out** on local edit (debounced) + **pull-in on app launch, on every foreground, and on a manual "Sync now"**. No timed background polling. |
| Sync order | Push-then-pull on each sync. |
| Conflict handling | Mirror SAF `*.sync-conflict-*` files into app-private so the **existing** conflict pipeline/UI works unchanged. |
| First link | If the folder already has `tasks.json`, adopt it (pull-in); otherwise seed the folder from the shadow. |
| Folder URI storage | Persisted `content://` tree URI string in `settings.data_file` (Android). |
| minSdk | Stays 24 (SAF tree URIs are API 21+); plan verifies the plugin's own floor. |
| Dependency risk | `tauri-plugin-android-fs` pinned + isolated behind `safsync` so it is swappable. |

## Architecture

**Principle: app-private dir = local working copy; SAF folder = remote mirror.**

- `store.rs`, `sync.rs`, `conflict.rs`, and the conflict commands stay **exactly as today**, operating on the app-private dir. The app-private dir holds both `tasks.json` (the shadow/master) **and** any mirrored `*.sync-conflict-*` files.
- A new Android-only module performs a **bidirectional file mirror** between the app-private dir and the picked SAF folder. Because the existing conflict scanner already scans the app-private dir, mirroring conflict files into it means **the entire existing conflict UI/commands work on Android with no changes** — this is the core simplification of the design.
- Desktop is untouched (it keeps watching its real data-file path directly).

```
              (existing, unchanged)                 (new, Android-only)
  React UI ─invoke─> commands/store.rs ──> app_data_dir()/           <─mirror─>  SAF folder
                       atomic write          tasks.json (master)                  tasks.json
                       notify watcher        *.sync-conflict-*  <─mirror─         *.sync-conflict-*
                       conflict scanner
```

## SAF plumbing

- **New dependency:** `tauri-plugin-android-fs` under `[target.'cfg(target_os = "android")'.dependencies]`, pinned to a specific version. Registered in `lib.rs` only under `#[cfg(target_os = "android")]`.
- **New module `src-tauri/src/safsync.rs`** (`#[cfg(target_os = "android")]`): the only file that touches the plugin. Responsibilities: pick & persist a folder URI; check/restore persisted permission; list the tree; read/write a file in the tree (mode `"rwt"`); and the mirror operations `push_out`/`pull_in`. SAF calls hidden behind a small internal trait so the pure mirror logic is unit-testable with a fake.
- **New commands** (cfg-gated; added to `generate_handler!`):
  - `pick_sync_folder() -> Result<SyncStatus>` — `pick_dir` → `take_persistable_uri_permission` → store URI in `settings.data_file` → run first-link logic → return status.
  - `clear_sync_folder() -> Result<()>` — drop the persisted URI from settings (and release permission).
  - `sync_now() -> Result<SyncStatus>` — push-then-pull; returns updated status (last-synced, conflict count, error).
  - `get_sync_status() -> Result<SyncStatus>` — current folder display name, linked?, permission-ok?, last-synced, last-error.
- On **desktop**, these commands are not registered (or are no-ops); the Settings UI hides the section.

## Data flow

**Push-out (automatic, debounced ~1s):** when a local mutation writes the shadow and a folder is linked, copy `tasks.json` → SAF folder via `"rwt"`. **Loop-suppressed by hash:** skip if the shadow's bytes equal the last bytes we pulled/pushed (prevents the pull→write-shadow→push echo).

**Pull-in (on launch, on foreground, on "Sync now"):** the webview detects foreground via the Page Visibility API (`visibilitychange` → visible) and invokes `sync_now`. Each sync is **push-then-pull**:
1. Push the shadow out first (flush local edits so Syncthing sees them / can raise a conflict file if there's a real collision).
2. Read the folder's `tasks.json`; if different from the shadow, **last-write-wins import** into the shadow (the normal reload path emits `store-changed` → UI refreshes), recording the hash for loop-suppression.
3. List the folder for `*.sync-conflict-*` matching `tasks.json`; mirror any new ones into app-private. The existing `list_conflicts` then surfaces them in `ConflictsView`.

**First link:** if the folder has a `tasks.json`, adopt it (pull-in path); else seed it from the shadow. (Android was local-only before, so adopting the desktop's list is the sensible default; genuine divergence still surfaces as Syncthing conflict files.)

## Conflict handling (reuse)

Unchanged pipeline. Pull-in copies Syncthing `*.sync-conflict-*` files from the SAF folder into the app-private dir; `list_conflicts` / `read_conflict` / `resolve_conflict` operate on them as on desktop. On resolve, also delete the SAF-side conflict file via the plugin.

## Settings UI

An **Android-only** "Sync folder" card in `SettingsView`:
- **Pick folder** (invokes `pick_sync_folder`), current folder display name, **Sync now** (invokes `sync_now`), last-synced time / error line, **Unlink** (invokes `clear_sync_folder`).
- Hidden on desktop (gated by platform — reuse the Phase 4 platform/viewport detection or `@tauri-apps/plugin-os`). Desktop keeps its existing direct-path model.

## Error handling

- The shadow is **never** destroyed by a sync failure; local data always survives.
- Revoked/expired URI permission (via `check_persisted_uri_permission`) → status shows "folder access lost — re-pick" and pulls/pushes no-op until re-linked.
- Invalid/torn JSON in the remote `tasks.json` → skip the import, set `last-error`, leave the shadow intact.
- SAF read/write/list failures → surfaced in `SyncStatus.last_error`; never partially apply.

## Module / file breakdown

| Path | Action | Responsibility |
|---|---|---|
| `src-tauri/Cargo.toml` | Modify | Add `tauri-plugin-android-fs` (pinned) under `[target.'cfg(target_os="android")'.dependencies]` |
| `src-tauri/src/safsync.rs` | Create (`#[cfg(target_os="android")]`) | Plugin wrapper + mirror logic (`push_out`/`pull_in`/first-link/hash loop-suppression) behind a testable trait |
| `src-tauri/src/commands.rs` | Modify | cfg-gated `pick_sync_folder`/`clear_sync_folder`/`sync_now`/`get_sync_status` + `SyncStatus` type |
| `src-tauri/src/lib.rs` | Modify | `#[cfg(target_os="android")]` register the plugin; hook debounced push-out into the mutation path; add commands to `generate_handler!` |
| `src-tauri/src/model.rs` | Possibly modify | Keep using `Settings.data_file` for the URI (no schema change expected) |
| `src/views/SettingsView.tsx` | Modify | Android-only "Sync folder" card |
| `src/lib/tauri.ts` | Modify | Wrappers for the 4 new commands + `SyncStatus` type; Page-Visibility → `sync_now` wiring (in app shell) |
| `src/state/store.ts` or `App.tsx` | Modify | Trigger `sync_now` on launch + on `visibilitychange` → visible (Android) |

## Testing

- **Unit (Rust):** hide SAF calls behind a trait; test the pure mirror logic with a fake backend — hash loop-suppression, push-then-pull ordering, first-link adopt-vs-seed, conflict-filename matching, "skip import on invalid JSON."
- **Existing suites stay green** (desktop unaffected; cfg-gated code doesn't compile into desktop).
- **Manual on-device smoke test:** link a real shared folder (Syncthing or a manually-shared dir), verify push-out reaches the folder, pull-in adopts remote edits, a planted `*.sync-conflict-*` surfaces in `ConflictsView` and resolves, and permission persists across an app restart.

## Scope / non-goals

**In:** Android folder pick + persisted permission; bidirectional file mirror (tasks.json + conflict files); auto debounced push-out; pull-in on launch/foreground/Sync-now; reuse of the existing conflict UI; Android Settings UI; hash loop-suppression; graceful permission-loss handling.

**Out (deferred):** any desktop change; timed background polling; sync while the app is closed (Syncthing transports in the background; Pansutong reads on next foreground — unchanged model); iOS; a desktop data-file-location picker UI; CRDT/auto-merge (still backlog).

## Risks

- **Single-maintainer dependency** (`tauri-plugin-android-fs`): pinned + isolated to `safsync.rs` so it can be replaced without touching the rest of the app.
- **SAF correctness hazards** (torn writes, slow/incomplete listings): bounded by the shadow being authoritative and by treating remote reads as best-effort that never clobber local data.
- **Foreground-driven pull latency**: acceptable per the chosen trigger model; a manual "Sync now" is always available.

## Open items for the implementation plan

- Exact `tauri-plugin-android-fs` version + its API surface/signatures at that version, and its declared minSdk.
- Whether the debounced push-out lives in Rust (a small debounce task keyed off the mutation path) or is triggered from the frontend after mutations; the spec prefers Rust-side so it covers all mutation entry points.
- The precise `SyncStatus` shape returned to the UI.
- How the Android-only Settings card is gated (platform detection vs. presence of the commands).
- First-link UX when the folder's `tasks.json` exists *and* the phone already has local tasks (v1: adopt remote; revisit if it bites).

## Citations

- https://github.com/tauri-apps/plugins-workspace/issues/933 (no Android folder picker)
- https://github.com/tauri-apps/tauri/issues/14587 (proposed `taurifs://`, unmerged)
- https://v2.tauri.app/plugin/dialog/ · https://v2.tauri.app/plugin/file-system/
- https://github.com/aiueo13/tauri-plugin-android-fs · https://docs.rs/crate/tauri-plugin-android-fs/ · https://crates.io/crates/tauri-plugin-android-fs
- https://commonsware.com/blog/2020/06/13/count-your-saf-uri-permission-grants.html (grant caps)
- https://commonsware.com/blog/2019/12/14/scoped-storage-stories-listfiles-woe.html (slow/incomplete SAF listing)
- https://developer.android.com/reference/android/database/ContentObserver · https://developer.android.com/reference/android/os/FileObserver
- https://developer.android.com/about/versions/11/privacy/storage
- https://docs.syncthing.net/users/syncing.html (conflict-file naming)
- https://philrich.dev/tauri-fs-android/
