# Pansutong Phase 4C — Desktop Sync-Folder (custom data-file location) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On desktop, let the user pick a folder (e.g. a Syncthing-managed folder) to hold `tasks.json`, so the desktop can participate in cross-device sync — replacing the read-only "Data file" stub in Settings with a working folder picker.

**Architecture:** Desktop uses real filesystem paths, so (unlike Android SAF) we simply **relocate the master `tasks.json`** into the chosen folder — all existing atomic-write, `notify` watcher, and conflict-scan code already work on any path. `AppState` gains a `repoint(new_path)` (adopt the folder's `tasks.json` if present, else seed it). The watcher is held in a swappable `Mutex<Option<SyncHandle>>` so repointing restarts it on the new directory live (no app restart). The chosen folder is stored in a **device-local sidecar** in the *default* app-data dir (read at startup) — NOT in the synced document, because the path is device-specific. The folder picker uses the official `tauri-plugin-dialog` (`open({ directory: true })` from JS), registered desktop-only.

**Tech Stack:** Tauri 2, `tauri-plugin-dialog` v2 (official), React + TypeScript, `@tauri-apps/plugin-os` (already a dep) for desktop detection.

**Scope:** Desktop (Windows/macOS/Linux) only. Android is unchanged (it uses app-private storage; cross-device sync on Android is the separate Phase 4B / `tauri-plugin-android-fs` work). This plan does not depend on Phase 4B.

## Context (verified current signatures on this branch = main)

- `store.rs` `AppState { inner: Mutex<Inner> }`, `Inner { doc: Document, path: PathBuf, last_written_hash: [u8;32] }`. Methods (pub): `open(path: PathBuf) -> Result<AppState>` (creates a default doc + file if absent, else loads), `read<F,T>`, `write<F,T>` (atomic write + updates hash), `reload_from_bytes(Vec<u8>)`, `path() -> PathBuf`, `last_written_hash() -> [u8;32]`. Private: `fn atomic_write(target,&[u8])`, `fn sha256(&[u8]) -> [u8;32]`. (A new `repoint` method added in Task 2 can call the private helpers since it's in `store.rs`.)
- `sync.rs`: `pub struct SyncHandle { _watcher: RecommendedWatcher, _thread: JoinHandle<()> }` (dropping it stops the watcher + its thread). `pub fn start(app: AppHandle, data_path: PathBuf) -> notify::Result<SyncHandle>` (watches `data_path.parent()`). `pub fn scan_conflict_files(&Path) -> Vec<String>`.
- `commands.rs`: `const STORE_CHANGED: &str = "store-changed";`, `fn emit_changed(app: &AppHandle)`, `fn now_ms() -> i64`. Command pattern: `#[tauri::command] pub fn x(input, state: State<'_, AppState>, app: AppHandle) -> Result<T>`.
- `lib.rs` `run()`: builder (opener, os, `#[cfg(desktop)]` global-shortcut) → `.setup(|app| { let data_dir = app.path().app_data_dir()...; let path = data_dir.join("tasks.json"); let state = AppState::open(path.clone())...; app.manage(state); match sync::start(handle, path) { Ok(h)=>app.manage(h), ... } #[cfg(desktop)] {quick-capture window + hotkey} Ok(()) })` → `generate_handler![... 19 commands ...]`. `use tauri::Manager;` present.
- `error.rs`: `enum AppError { Io(io::Error), Serde(serde_json::Error), NotFound(String), Invalid(String) }`, `From<io::Error>`, `From<serde_json::Error>`, `type Result<T>`.
- `model.rs`: `Settings { data_file: Option<String>, theme: String, device_id: String }`; `Document { version, settings, projects, tags, tasks }` (Clone + serde).
- Frontend: `src/lib/tauri.ts` `api` object (`invoke` from `@tauri-apps/api/core`); `src/views/SettingsView.tsx` has the theme buttons + a read-only "Data file" `<section>` showing `doc.settings.data_file ?? "(default app data directory)"`. `@tauri-apps/plugin-os` is a dependency but unused in `src/`.

### tauri-plugin-dialog v2 (official) API used here

- Rust: `tauri-plugin-dialog = "2"`; register `.plugin(tauri_plugin_dialog::init())`. Permission: `dialog:default`.
- JS: `@tauri-apps/plugin-dialog`; `import { open } from "@tauri-apps/plugin-dialog";` then `const dir = await open({ directory: true, multiple: false, title: "Choose a sync folder" });` → returns `string | null` (the absolute folder path, or `null` if cancelled). Directory selection is supported on desktop (it is NOT on Android — that's why this feature is desktop-only).

---

## Files this plan creates or modifies

| Path | Action | Responsibility |
|---|---|---|
| `src-tauri/Cargo.toml` | Modify | Add `tauri-plugin-dialog = "2"` to the existing desktop target-deps section |
| `src-tauri/capabilities/desktop-dialog.json` | Create | Desktop-only capability granting `dialog:default` |
| `src-tauri/src/store.rs` | Modify | Add `AppState::repoint(new_path)` (adopt-or-seed) |
| `src-tauri/src/location.rs` | Create | Device-local data-location sidecar (load/save) + `resolve_data_path` |
| `src-tauri/src/sync.rs` | Modify | Add `WatcherHandle(Mutex<Option<SyncHandle>>)` + `restart` helper |
| `src-tauri/src/commands.rs` | Modify | `set_data_folder` / `clear_data_folder` / `get_data_location` + `DataLocation` |
| `src-tauri/src/lib.rs` | Modify | `mod location;` register dialog (desktop); startup reads the sidecar; manage `WatcherHandle`; register 3 commands |
| `package.json` | Modify | Add `@tauri-apps/plugin-dialog` |
| `src/lib/platform.ts` | Create | `isAndroid()` via `@tauri-apps/plugin-os` |
| `src/lib/tauri.ts` | Modify | `DataLocation` type + `pickAndSetDataFolder` / `clearDataFolder` / `getDataLocation` wrappers |
| `src/views/SettingsView.tsx` | Modify | Replace the read-only "Data file" section with a working desktop folder picker |

---

## Task 1 — Add `tauri-plugin-dialog` (desktop) + capability + JS package

**Files:** `src-tauri/Cargo.toml`, `src-tauri/capabilities/desktop-dialog.json` (create), `src-tauri/src/lib.rs`, `package.json`.

- [ ] **Step 1.1: Rust dep (desktop-only)**

In `src-tauri/Cargo.toml`, add to the existing `[target.'cfg(not(any(target_os = "android", target_os = "ios")))'.dependencies]` section (which already has `tauri-plugin-global-shortcut`):

```toml
tauri-plugin-dialog = "2"
```

- [ ] **Step 1.2: Register the plugin (desktop only)**

In `src-tauri/src/lib.rs`, extend the existing `#[cfg(desktop)] let builder = builder.plugin(...)` block by chaining a second plugin. Replace:

```rust
    #[cfg(desktop)]
    let builder = builder.plugin(
        tauri_plugin_global_shortcut::Builder::new()
            .with_handler(|app, _shortcut, event| {
```

…leave that block as-is, and immediately AFTER its closing `);` add:

```rust
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_dialog::init());
```

- [ ] **Step 1.3: Desktop-only capability**

Create `src-tauri/capabilities/desktop-dialog.json`:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "desktop-dialog",
  "description": "Folder picker for the desktop sync-folder setting",
  "platforms": ["windows", "macOS", "linux"],
  "windows": ["main"],
  "permissions": ["dialog:default"]
}
```

- [ ] **Step 1.4: JS package**

In `package.json` `dependencies`, add:

```json
"@tauri-apps/plugin-dialog": "^2"
```

- [ ] **Step 1.5: Verify**

```
npm install
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
npx tsc --noEmit
```

Expected: install clean; cargo check clean (downloads tauri-plugin-dialog); 44 cargo tests pass; tsc clean. (`cargo check` validates `desktop-dialog.json` via tauri-build — confirms `dialog:default` exists.)

- [ ] **Step 1.6: Commit**

```
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/capabilities/desktop-dialog.json src-tauri/src/lib.rs package.json package-lock.json
git commit -m "Add tauri-plugin-dialog (desktop) for the sync-folder picker"
```

---

## Task 2 — `AppState::repoint` (adopt-or-seed) — TDD

**Files:** `src-tauri/src/store.rs`.

- [ ] **Step 2.1: Write the failing tests**

Add to the `#[cfg(test)] mod tests` in `src-tauri/src/store.rs` (if none exists, create one at the end of the file):

```rust
#[cfg(test)]
mod repoint_tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn repoint_seeds_when_target_absent() {
        let dir = tempdir().unwrap();
        let state = AppState::open(dir.path().join("tasks.json")).unwrap();
        // mutate so the seeded copy is observable
        state.write(|d| { d.settings.theme = "dark".into(); Ok(()) }).unwrap();

        let target_dir = tempdir().unwrap();
        let new_path = target_dir.path().join("tasks.json");
        assert!(!new_path.exists());
        state.repoint(new_path.clone()).unwrap();

        assert!(new_path.exists(), "seeded file should be created");
        assert_eq!(state.path(), new_path);
        let bytes = std::fs::read(&new_path).unwrap();
        let doc: crate::model::Document = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(doc.settings.theme, "dark");
    }

    #[test]
    fn repoint_adopts_existing_target() {
        let dir = tempdir().unwrap();
        let state = AppState::open(dir.path().join("tasks.json")).unwrap();

        // Build a different doc and write it to the target.
        let target_dir = tempdir().unwrap();
        let new_path = target_dir.path().join("tasks.json");
        let mut other = state.read(|d| d.clone());
        other.settings.theme = "light".into();
        std::fs::write(&new_path, serde_json::to_vec_pretty(&other).unwrap()).unwrap();

        state.repoint(new_path.clone()).unwrap();

        assert_eq!(state.path(), new_path);
        // In-memory doc adopted the target's content.
        assert_eq!(state.read(|d| d.settings.theme.clone()), "light");
        // Hash now matches the adopted bytes, so the watcher won't re-import.
        let h = {
            use sha2::{Digest, Sha256};
            let mut hh = Sha256::new();
            hh.update(std::fs::read(&new_path).unwrap());
            let out: [u8; 32] = hh.finalize().into();
            out
        };
        assert_eq!(state.last_written_hash(), h);
    }
}
```

- [ ] **Step 2.2: Run to confirm failure**

Run: `cargo test --manifest-path src-tauri/Cargo.toml repoint`
Expected: FAIL — `repoint` not found.

- [ ] **Step 2.3: Implement `repoint`**

Add this method inside `impl AppState` in `src-tauri/src/store.rs`:

```rust
    /// Relocate the master data file to `new_path`. If `new_path` already exists,
    /// adopt its contents (last-write-wins); otherwise seed it from the current
    /// in-memory document. Updates the stored path and the loop-suppression hash.
    pub fn repoint(&self, new_path: std::path::PathBuf) -> Result<()> {
        let mut g = self.inner.lock().unwrap();
        if new_path.exists() {
            let bytes = std::fs::read(&new_path)?;
            let doc: Document = serde_json::from_slice(&bytes)?;
            g.doc = doc;
            g.last_written_hash = sha256(&bytes);
            g.path = new_path;
        } else {
            let bytes = serde_json::to_vec_pretty(&g.doc)?;
            atomic_write(&new_path, &bytes)?;
            g.last_written_hash = sha256(&bytes);
            g.path = new_path;
        }
        Ok(())
    }
```

(`Document`, `sha256`, `atomic_write` are all in scope within `store.rs`. Confirm the `use` for `Document` exists at the top of `store.rs`; if `Document` is referenced as `crate::model::Document` elsewhere in the file, match that style.)

- [ ] **Step 2.4: Run to confirm pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml repoint`
Expected: PASS (2 tests). Then `cargo test --manifest-path src-tauri/Cargo.toml` → 46 tests pass.

- [ ] **Step 2.5: Commit**

```
git add src-tauri/src/store.rs
git commit -m "Add AppState::repoint (adopt-or-seed) with tests"
```

---

## Task 3 — Device-local location sidecar

**Files:** Create `src-tauri/src/location.rs`; modify `src-tauri/src/lib.rs` (declare the module).

- [ ] **Step 3.1: Create `src-tauri/src/location.rs`**

```rust
//! Device-local persistence of the user's chosen data-file folder.
//!
//! The chosen folder is stored in `<default app_data_dir>/data_location.json`,
//! which is NEVER synced (it lives in app-private storage, separate from the
//! possibly-relocated tasks.json). This avoids a device-specific path leaking
//! into the synced document.

use crate::error::Result;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

const SIDECAR: &str = "data_location.json";
const DATA_FILE: &str = "tasks.json";

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DataLocationConfig {
    /// Absolute folder path chosen by the user; `None` = use the default dir.
    pub folder: Option<String>,
}

fn sidecar_path(default_dir: &Path) -> PathBuf {
    default_dir.join(SIDECAR)
}

pub fn load(default_dir: &Path) -> DataLocationConfig {
    std::fs::read(sidecar_path(default_dir))
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

pub fn save(default_dir: &Path, cfg: &DataLocationConfig) -> Result<()> {
    let bytes = serde_json::to_vec_pretty(cfg)?;
    std::fs::write(sidecar_path(default_dir), bytes)?;
    Ok(())
}

/// Resolve the effective tasks.json path: `<folder>/tasks.json` if a valid
/// folder is configured, else `<default_dir>/tasks.json`.
pub fn resolve_data_path(default_dir: &Path) -> PathBuf {
    let cfg = load(default_dir);
    match cfg.folder {
        Some(ref f) if Path::new(f).is_dir() => Path::new(f).join(DATA_FILE),
        _ => default_dir.join(DATA_FILE),
    }
}
```

- [ ] **Step 3.2: Declare the module**

In `src-tauri/src/lib.rs`, add `pub mod location;` with the other `pub mod` lines (after `pub mod error;`).

- [ ] **Step 3.3: Verify**

```
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: clean; 46 tests pass.

- [ ] **Step 3.4: Commit**

```
git add src-tauri/src/location.rs src-tauri/src/lib.rs
git commit -m "Add device-local data-location sidecar"
```

---

## Task 4 — Swappable watcher + startup uses the resolved path

**Files:** `src-tauri/src/sync.rs`, `src-tauri/src/lib.rs`.

- [ ] **Step 4.1: Add a swappable watcher handle in `sync.rs`**

Append to `src-tauri/src/sync.rs`:

```rust
use std::sync::Mutex;

/// Managed wrapper so the watcher can be replaced when the data path changes.
pub struct WatcherHandle(pub Mutex<Option<SyncHandle>>);

/// Stop the current watcher (if any) and start a new one on `data_path`'s dir.
pub fn restart(handle: &WatcherHandle, app: &AppHandle, data_path: PathBuf) {
    let mut g = handle.0.lock().unwrap();
    *g = None; // drop the old watcher + let its thread exit
    match start(app.clone(), data_path) {
        Ok(h) => { *g = Some(h); }
        Err(e) => { eprintln!("warning: failed to restart watcher: {e}"); }
    }
}
```

- [ ] **Step 4.2: Startup resolves the path + manages `WatcherHandle`**

In `src-tauri/src/lib.rs` `.setup(...)`, replace the current block:

```rust
            let data_dir = app
                .path()
                .app_data_dir()
                .expect("app_data_dir resolvable");
            std::fs::create_dir_all(&data_dir).expect("create app data dir");
            let path = data_dir.join("tasks.json");
            let state = AppState::open(path.clone()).expect("open store");
            app.manage(state);

            let handle = app.handle().clone();
            match crate::sync::start(handle, path) {
                Ok(sync_handle) => {
                    app.manage(sync_handle);
                }
                Err(e) => {
                    eprintln!("warning: filesystem watcher failed to start: {e}");
                }
            }
```

with:

```rust
            let default_dir = app
                .path()
                .app_data_dir()
                .expect("app_data_dir resolvable");
            std::fs::create_dir_all(&default_dir).expect("create app data dir");
            // Effective path honours a device-local custom folder, if set.
            let path = crate::location::resolve_data_path(&default_dir);
            if let Some(parent) = path.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            let state = AppState::open(path.clone()).expect("open store");
            app.manage(state);

            let handle = app.handle().clone();
            let sync_handle = crate::sync::start(handle, path).ok();
            if sync_handle.is_none() {
                eprintln!("warning: filesystem watcher failed to start");
            }
            app.manage(crate::sync::WatcherHandle(std::sync::Mutex::new(sync_handle)));
```

- [ ] **Step 4.3: Verify**

```
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: clean; 46 tests pass. (Behaviour unchanged at runtime: with no sidecar, `resolve_data_path` returns the default path.)

- [ ] **Step 4.4: Commit**

```
git add src-tauri/src/sync.rs src-tauri/src/lib.rs
git commit -m "Make the watcher swappable; startup uses the resolved data path"
```

---

## Task 5 — Commands: set / clear / get the data folder

**Files:** `src-tauri/src/commands.rs`, `src-tauri/src/lib.rs`.

- [ ] **Step 5.1: Add the commands in `commands.rs`**

Add (near the other commands). Note `emit_changed`, `AppState`, `State`, `AppHandle`, `Result`, `AppError`, `PathBuf`, `Manager` usage:

```rust
#[derive(serde::Serialize)]
pub struct DataLocation {
    /// User-chosen folder, or null when using the default app-data dir.
    pub folder: Option<String>,
    /// The effective absolute tasks.json path in use right now.
    pub effective_path: String,
}

fn default_data_dir(app: &AppHandle) -> Result<PathBuf> {
    app.path()
        .app_data_dir()
        .map_err(|e| AppError::Invalid(format!("app_data_dir: {e}")))
}

#[tauri::command]
pub fn get_data_location(state: State<'_, AppState>, app: AppHandle) -> Result<DataLocation> {
    let cfg = crate::location::load(&default_data_dir(&app)?);
    Ok(DataLocation {
        folder: cfg.folder,
        effective_path: state.path().to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub fn set_data_folder(
    folder: String,
    state: State<'_, AppState>,
    watcher: State<'_, crate::sync::WatcherHandle>,
    app: AppHandle,
) -> Result<DataLocation> {
    let folder_path = PathBuf::from(&folder);
    if !folder_path.is_dir() {
        return Err(AppError::Invalid(format!("not a folder: {folder}")));
    }
    let new_path = folder_path.join("tasks.json");
    state.repoint(new_path.clone())?;
    crate::location::save(
        &default_data_dir(&app)?,
        &crate::location::DataLocationConfig { folder: Some(folder) },
    )?;
    crate::sync::restart(&watcher, &app, new_path);
    emit_changed(&app);
    let _ = app.emit("conflicts-detected", &crate::sync::scan_conflict_files(&state.path()));
    get_data_location(state, app.clone())
}

#[tauri::command]
pub fn clear_data_folder(
    state: State<'_, AppState>,
    watcher: State<'_, crate::sync::WatcherHandle>,
    app: AppHandle,
) -> Result<DataLocation> {
    let default_dir = default_data_dir(&app)?;
    let new_path = default_dir.join("tasks.json");
    state.repoint(new_path.clone())?;
    crate::location::save(&default_dir, &crate::location::DataLocationConfig { folder: None })?;
    crate::sync::restart(&watcher, &app, new_path);
    emit_changed(&app);
    get_data_location(state, app.clone())
}
```

Note on borrow: `get_data_location(state, app.clone())` is called at the end of `set_data_folder`/`clear_data_folder`, which consume `state` (a `State` is `Copy`-like via re-borrow — if the compiler complains about a moved `state`, change the final call to construct the `DataLocation` inline using `state.path()` + `crate::location::load(&default_dir)` instead of delegating). Keep `app.clone()` since `app` is used by `emit_changed`/`emit` earlier.

- [ ] **Step 5.2: Register the commands**

In `src-tauri/src/lib.rs` `generate_handler!`, add after `commands::dismiss_conflict,`:

```rust
            commands::get_data_location,
            commands::set_data_folder,
            commands::clear_data_folder,
```

- [ ] **Step 5.3: Verify**

```
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
npx tsc --noEmit
```

Expected: clean; 46 tests pass; tsc clean. If the `state`-move borrow error appears, apply the inline fix noted in Step 5.1.

- [ ] **Step 5.4: Commit**

```
git add src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "Add set/clear/get data-folder commands"
```

---

## Task 6 — Frontend: platform helper, wrappers, desktop picker UI

**Files:** Create `src/lib/platform.ts`; modify `src/lib/tauri.ts`, `src/views/SettingsView.tsx`.

- [ ] **Step 6.1: Create `src/lib/platform.ts`**

```ts
import { type } from "@tauri-apps/plugin-os";

let cached: boolean | null = null;

/** True when running on Android (the desktop sync-folder picker is hidden there). */
export async function isAndroid(): Promise<boolean> {
  if (cached === null) {
    try {
      cached = (await type()) === "android";
    } catch {
      cached = false;
    }
  }
  return cached;
}
```

- [ ] **Step 6.2: Add the type + wrappers in `src/lib/tauri.ts`**

Add the type near the other types:

```ts
export type DataLocation = { folder: string | null; effective_path: string };
```

Add to the `api` object (after `dismissConflict`), importing `open` from the dialog plugin at the top of the file:

```ts
import { open } from "@tauri-apps/plugin-dialog";
```

```ts
  getDataLocation: () => invoke<DataLocation>("get_data_location"),
  clearDataFolder: () => invoke<DataLocation>("clear_data_folder"),
  /** Opens the OS folder picker; on a selection, repoints tasks.json into it. Returns null if cancelled. */
  pickAndSetDataFolder: async (): Promise<DataLocation | null> => {
    const dir = await open({ directory: true, multiple: false, title: "Choose a sync folder" });
    if (typeof dir !== "string") return null;
    return invoke<DataLocation>("set_data_folder", { folder: dir });
  },
```

- [ ] **Step 6.3: Replace the read-only "Data file" section in `SettingsView.tsx`**

Add imports:

```tsx
import { useEffect, useState } from "react";
import { api, DataLocation } from "../lib/tauri";
import { isAndroid } from "../lib/platform";
```

Inside the component, before `return`:

```tsx
  const [android, setAndroid] = useState(false);
  const [loc, setLoc] = useState<DataLocation | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { void isAndroid().then(setAndroid); }, []);
  useEffect(() => { void api.getDataLocation().then(setLoc).catch(() => {}); }, []);

  const pick = async () => {
    setBusy(true); setErr(null);
    try {
      const next = await api.pickAndSetDataFolder();
      if (next) setLoc(next);
    } catch (e) { setErr(String(e)); }
    finally { setBusy(false); }
  };
  const reset = async () => {
    setBusy(true); setErr(null);
    try { setLoc(await api.clearDataFolder()); }
    catch (e) { setErr(String(e)); }
    finally { setBusy(false); }
  };
```

Replace the existing read-only "Data file" `<section>` (the one with `<h2>Data file</h2>` and the "Custom paths come in Phase 2-sync" text) with:

```tsx
      <section className="settings-section">
        <h2>Data file</h2>
        <p className="view-sub">
          Tasks persist to: <code>{loc?.effective_path ?? "…"}</code>
        </p>
        {android ? (
          <p className="view-sub">
            On Android, use the in-app sync folder (Android storage access), not this picker.
          </p>
        ) : (
          <>
            <p className="view-sub">
              Point this at a Syncthing-managed folder to sync across devices. On first link it
              adopts that folder's <code>tasks.json</code> if present, otherwise it seeds it.
            </p>
            <div className="theme-options">
              <button className="theme-option" disabled={busy} onClick={pick}>Choose folder…</button>
              {loc?.folder && (
                <button className="theme-option" disabled={busy} onClick={reset}>Use default location</button>
              )}
            </div>
            {err && <p className="view-sub" style={{ color: "var(--c-danger)" }}>{err}</p>}
          </>
        )}
      </section>
```

- [ ] **Step 6.4: Verify**

```
npx tsc --noEmit
npm test
npm run build
```

Expected: tsc clean; vitest unchanged (20 pass); build clean (emits both `index.html` and `quick-capture.html`).

- [ ] **Step 6.5: Commit**

```
git add src/lib/platform.ts src/lib/tauri.ts src/views/SettingsView.tsx
git commit -m "Desktop Settings: working sync-folder picker (relocate tasks.json)"
```

---

## Task 7 — Manual desktop smoke test

**Files:** none (verification only). Run by the user in a real terminal (`tauri dev` detaches when backgrounded).

- [ ] **Step 7.1: Launch**

```
npm run tauri dev
```

- [ ] **Step 7.2: Pick a folder**

Settings → **Data file** → **Choose folder…** → pick an empty folder (e.g. a Syncthing folder). Confirm "Tasks persist to:" updates to `<folder>\tasks.json`, and that a `tasks.json` was seeded there (check in a file manager).

- [ ] **Step 7.3: Live behaviour (no restart)**

Add a task → confirm `<folder>\tasks.json` updates immediately. Externally edit that file (add a task in an editor) → the app picks it up within ~1s (the watcher restarted on the new folder).

- [ ] **Step 7.4: Adopt-on-link**

**Use default location**, then put a `tasks.json` with some tasks in a different folder, **Choose folder…** that folder → confirm the app adopts those tasks.

- [ ] **Step 7.5: Persistence**

Quit and relaunch `tauri dev` → confirm it still uses the chosen folder (the device-local sidecar persisted it) and the tasks are intact.

- [ ] **Step 7.6: No commit** — verification only.

---

## Self-review (against the approved design)

- Desktop folder picker replacing the read-only stub → Task 6. ✓
- Relocate the master `tasks.json` (real path; reuse atomic-write/watcher/conflict) → Task 2 (`repoint`), Task 4 (watcher restart), Task 5 (commands). ✓
- Adopt-if-present-else-seed → Task 2 (`repoint`), tested. ✓
- Live repoint, no app restart (watcher swapped) → Task 4 (`WatcherHandle`/`restart`), Task 5. ✓
- Path stored device-locally, NOT in synced doc → Task 3 (sidecar in default app-data dir). ✓
- Official `tauri-plugin-dialog`, desktop-only; picker hidden on Android → Task 1 (desktop dep + capability), Task 6 (`isAndroid` gate). ✓
- Android unchanged → all new Rust is platform-neutral or desktop-gated; `resolve_data_path` returns the default on Android (no sidecar is ever written there). ✓

## Scope / non-goals

In: desktop folder picker, relocate-master with adopt-or-seed, live watcher restart, device-local path persistence, Settings UI.

Out: Android (separate Phase 4B), choosing an exact file name (folder-only for v1), multiple data files/profiles, conflict-resolution changes (the existing conflict UI already works on the new path).

## Notes for the implementer

- `tauri-plugin-dialog` is an official, stable plugin; the `open({directory:true})` JS API and `dialog:default` permission are standard. If `cargo check` flags the capability, confirm the permission id against the generated `gen/schemas/desktop-schema.json`.
- The only borrow subtlety is the end-of-command delegation in Task 5 (`get_data_location(state, app.clone())`); if the compiler objects to a moved `state`, inline the `DataLocation` construction as noted.
- After repointing, the old default `tasks.json` is left in place as a harmless backup; this is intentional (no destructive moves).
