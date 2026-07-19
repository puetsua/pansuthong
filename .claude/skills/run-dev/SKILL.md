---
name: run-dev
description: Run Pansuthong in development mode. Use when the user asks to "run the app", "start dev", "test on Windows", or "test on Android". Picks the right target and verifies prerequisites first.
---

# Run Pansuthong in dev

## Pick the target

- User says "desktop", "Windows", or just "run it" with no qualifier → **desktop**.
- User says "Android", "phone", "mobile", "emulator", "device" → **Android**.
- Ambiguous → ask.

## Desktop

Preflight:

```pwsh
cargo --version
```

If `cargo` is missing, stop and explain: Rust is required (see `/setup-tauri-android` or https://rustup.rs/).

Then run in the background and surface the dev-server URL once Vite reports ready:

```pwsh
npm run tauri dev
```

(First run compiles the full Rust dep tree — several minutes. Don't kill it early.)

## Android

Preflight (all must pass):

```pwsh
cargo --version
$env:ANDROID_HOME
$env:NDK_HOME
$env:JAVA_HOME
Test-Path src-tauri\gen\android
```

If any check fails, route to `/setup-tauri-android`.

Confirm a device or emulator is connected:

```pwsh
adb devices
```

Then:

```pwsh
npm run tauri android dev
```

If multiple devices are listed, pass `--device <serial>`.

## Stopping

Kill the foreground process (Ctrl+C in its terminal). For background runs, find the PID and `Stop-Process -Id <pid>`.
