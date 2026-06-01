# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Project

Pansutong is a cross-platform task tracker built with **Tauri 2**, targeting **Windows desktop and Android** from a single codebase. The Rust crate is named `pansutong` (lib: `pansutong_lib`); the app bundle identifier is `net.puetsua.pansutong`.

## Data model

**Tasks and tags are the core data — every other feature is built around them.** When designing or changing functionality, treat the task/tag model as primary and make new features serve it; do not introduce data that competes with or sits beside this center. **Projects were removed in favor of tags** (resolves #5, #7) — express any grouping through tags; do not reintroduce a parallel grouping concept.

The synced root is a single `Document` (`src-tauri/src/model.rs`, mirrored as a TS `type` in `src/lib/tauri.ts`) holding just `tasks` and `tags`. **Settings are NOT synced** — they live device-locally in `config.json` (see below).

- A **task** carries its own fields (title, done, dates, notes) plus `tag_ids: string[]` — tasks reference tags, never the reverse. A task has **no priority field**: its priority is *derived* from its tags (resolves #4).
- A **tag** is flat (`id`, `name`, `color`, `priority`) — `priority` is an integer weight (`-9999..=9999`, default 0); no hierarchy or parent grouping. A task's effective priority is the **max weight among its tags** (0 if untagged; a negative weight sinks a task below untagged ones). The old `!`/`!!`/`!!!` composer shortcut was removed.
- Views are **queries over tasks + tags** computed in `Document` helpers, not separate stored collections — e.g. `tasks_today` (date-based), `tasks_inbox` (`task_in_inbox` = task has no tags), and `tasks_for_tag`. Task lists are ordered by `settings.sort_order` (`"priority"` = weight desc → date → insertion, the default; or `"date"`), applied in the TS `buildIndexes`.
- Keep model changes additive and backward-compatible: use `#[serde(default)]` / optional TS keys so older data files still load.

**Settings & data-folder config are device-local** (`src-tauri/src/config.rs`), stored in `<app_data_dir>/config.json` — **never synced**, so each device keeps its own theme/sort/Upcoming-horizon and the chosen sync-folder path never leaks across devices. `config.json` holds `{ folder, settings }`: `folder` is the user-chosen data-folder (`None` = default dir), `settings` is `{ theme, sort_order, upcoming_days }`. The managed `ConfigState` owns it; `get_document`/`sync_now` return a `DocumentView` that splices `settings` into the synced doc so the frontend still receives one payload. On first launch after the rename, `load_or_migrate` carries forward a legacy `data_location.json` folder and lifts the old `settings` out of `tasks.json`.

## Stack

- **Tauri 2** (Rust core in `src-tauri/`)
- **React 19 + TypeScript + Vite** (frontend in `src/`)
- Persistence: JSON file in `app_data_dir()`/`tasks.json` (works on both desktop and Android — do **not** hard-code paths)

## Commands

- `npm run tauri dev` — desktop dev (Vite dev server on `:1420` + native window)
- `npm run tauri android dev` — Android dev (emulator or USB device)
- `npm run tauri build` — desktop production build
- `npm run tauri android build` — Android production build (`--apk` or `--aab`)
- `npm run build` — frontend only (`tsc && vite build`)
- `npx tsc --noEmit` — type-check without emitting

Use `npm run tauri <subcommand>` rather than calling `tauri` directly — the CLI is a devDependency, not a global.

## Toolchain status (configured 2026-05-29)

Both the desktop and Android build toolchains are set up on this machine. Env vars below are set **persistently at User scope** — a running Codex session keeps its original environment, so **restart Codex after any env change** for child shells to inherit it.

- **Rust** installed; all four Android targets added (`aarch64-linux-android`, `armv7-linux-androideabi`, `i686-linux-android`, `x86_64-linux-android`) alongside `x86_64-pc-windows-msvc`.
- **`JAVA_HOME`** = `C:\Program Files\Android\Android Studio1\jbr` — bundled OpenJDK **21.0.8** (Gradle-compatible). The standalone JDK 25 / 11 / 8 installs are unsuitable; do not point JAVA_HOME at them. Note the install dir is `Android Studio1`, not `Android Studio` (the latter's `jre` is broken).
- **`ANDROID_HOME`** = `C:\Data\Android` — platforms `android-34/35/36`, build-tools `35.0.0`/`36.1.0`, `platform-tools` (adb), `emulator`, cmake `3.22.1`.
- **`NDK_HOME`** = `C:\Data\Android\ndk\28.2.13676358` — must be the **versioned** subdir, not the parent `ndk\`.
- **`tauri android init` has been run** — `src-tauri/gen/android/` exists (initially untracked; commit it as part of Phase 4).
- **No CLI `sdkmanager`/`avdmanager`** (`cmdline-tools` is empty). Manage SDK packages and AVDs via **Android Studio's GUI**. A no-CLI consequence: there is no installed system image — create/launch an emulator from Android Studio's Device Manager. A running emulator shows up as `emulator-5554` via `C:\Data\Android\platform-tools\adb.exe devices`; `tauri android dev` targets it automatically.

See https://tauri.app/start/prerequisites/ and https://v2.tauri.app/develop/#mobile for current setup.

## Project conventions

- Rust commands live in `src-tauri/src/lib.rs` (the `#[cfg_attr(mobile, tauri::mobile_entry_point)]` `run()` is shared by desktop and Android — keep mobile-safe; no desktop-only crates like `winapi`).
- Frontend talks to Rust via `invoke<T>("command_name", { args })` from `@tauri-apps/api/core`. Argument keys must be **camelCase** on the JS side and Rust commands receive them as **snake_case** parameters automatically.
- Persisted data goes through `app.path().app_data_dir()` — never `std::env::current_dir()` or absolute paths. On Android this resolves to app-private storage; on Windows it's `%APPDATA%\<identifier>\`.
- New Tauri commands must be added to the `tauri::generate_handler![...]` list in `lib.rs` AND will need a matching `permissions` entry in `src-tauri/capabilities/default.json` if they expose anything beyond the default core set.
- Don't reintroduce the scaffolded `greet` command or sample logos — they were intentionally removed.
- **Adding a new section to the Settings screen requires the user's explicit approval first.** The Settings screen is deliberately kept minimal; do not introduce a new settings section or control without asking and getting an OK.

## Code style

- TypeScript: 2-space indent (matches scaffold). Prefer `type` over `interface` for plain data shapes.
- Rust: standard `rustfmt` defaults. Run `cargo fmt` from `src-tauri/` once Rust is installed.
- Keep cross-platform code in `lib.rs`. Use `#[cfg(target_os = "android")]` / `#[cfg(desktop)]` only when truly necessary.

## Gotchas

- `npm create tauri-app` does not require Rust, but `npm run tauri dev` does — the missing-Rust error is silent until first build.
- Vite dev server is fixed to port **1420** (see `tauri.conf.json` `devUrl`); changing it requires updating both files.
- The Cargo lib name is `pansutong_lib` (not `pansutong`) to avoid Windows-only lib/bin name collision — see comment in `src-tauri/Cargo.toml`.
- Android builds need `ANDROID_HOME` to point at the SDK root, `NDK_HOME` at a specific NDK version dir (e.g. `$ANDROID_HOME/ndk/<version>`), not the parent.
