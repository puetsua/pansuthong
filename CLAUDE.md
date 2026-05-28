# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Pansutong is a cross-platform task tracker built with **Tauri 2**, targeting **Windows desktop and Android** from a single codebase. The Rust crate is named `pansutong` (lib: `pansutong_lib`); the app bundle identifier is `net.puetsua.pansutong`.

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

## Prerequisites (currently missing on this machine — flag before suggesting a build)

- **Rust toolchain** is **NOT installed** (`cargo`/`rustc` missing). Required for any Tauri build. Install via https://rustup.rs/ — pick the MSVC toolchain on Windows.
- **Android targets not yet added.** After installing Rust, add: `rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android`.
- **Android env vars not set** (`ANDROID_HOME`, `NDK_HOME`, `JAVA_HOME` are all empty). Tauri's Android tooling requires all three. `JAVA_HOME` should point at the existing Eclipse Adoptium JDK at `C:\Program Files\Eclipse Adoptium\jdk-25.0.1.8-hotspot\` (note: Tauri/Gradle typically wants JDK 17 or 21 — verify JDK 25 works or install 21).
- **`tauri android init` has not been run.** Run it once after Rust + Android SDK/NDK are set up; it generates `src-tauri/gen/android/`.

See https://tauri.app/start/prerequisites/ and https://v2.tauri.app/develop/#mobile for current setup.

## Project conventions

- Rust commands live in `src-tauri/src/lib.rs` (the `#[cfg_attr(mobile, tauri::mobile_entry_point)]` `run()` is shared by desktop and Android — keep mobile-safe; no desktop-only crates like `winapi`).
- Frontend talks to Rust via `invoke<T>("command_name", { args })` from `@tauri-apps/api/core`. Argument keys must be **camelCase** on the JS side and Rust commands receive them as **snake_case** parameters automatically.
- Persisted data goes through `app.path().app_data_dir()` — never `std::env::current_dir()` or absolute paths. On Android this resolves to app-private storage; on Windows it's `%APPDATA%\<identifier>\`.
- New Tauri commands must be added to the `tauri::generate_handler![...]` list in `lib.rs` AND will need a matching `permissions` entry in `src-tauri/capabilities/default.json` if they expose anything beyond the default core set.
- Don't reintroduce the scaffolded `greet` command or sample logos — they were intentionally removed.

## Code style

- TypeScript: 2-space indent (matches scaffold). Prefer `type` over `interface` for plain data shapes.
- Rust: standard `rustfmt` defaults. Run `cargo fmt` from `src-tauri/` once Rust is installed.
- Keep cross-platform code in `lib.rs`. Use `#[cfg(target_os = "android")]` / `#[cfg(desktop)]` only when truly necessary.

## Gotchas

- `npm create tauri-app` does not require Rust, but `npm run tauri dev` does — the missing-Rust error is silent until first build.
- Vite dev server is fixed to port **1420** (see `tauri.conf.json` `devUrl`); changing it requires updating both files.
- The Cargo lib name is `pansutong_lib` (not `pansutong`) to avoid Windows-only lib/bin name collision — see comment in `src-tauri/Cargo.toml`.
- Android builds need `ANDROID_HOME` to point at the SDK root, `NDK_HOME` at a specific NDK version dir (e.g. `$ANDROID_HOME/ndk/<version>`), not the parent.
