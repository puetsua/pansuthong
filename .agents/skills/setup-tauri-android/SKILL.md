---
name: setup-tauri-android
description: One-time setup checklist for getting Tauri Android builds working on this machine. Use when the user wants to build/run on Android for the first time, or when `npm run tauri android dev` fails with missing-toolchain errors.
---

# Tauri Android setup for Pansutong

Walk through these checks **in order**. Stop and prompt the user if a step would install something or modify their env.

## 1. Rust toolchain

```pwsh
cargo --version
rustc --version
```

If missing: direct the user to https://rustup.rs/ and choose the **MSVC** toolchain on Windows. Don't try to install Rust automatically.

## 2. Android Rust targets

```pwsh
rustup target list --installed
```

The four Android targets must be present:

```pwsh
rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
```

## 3. JDK

```pwsh
java --version
$env:JAVA_HOME
```

Tauri/Gradle typically expect **JDK 17 or 21**. This machine has JDK 25 at `C:\Program Files\Eclipse Adoptium\jdk-25.0.1.8-hotspot\`. If Android Gradle Plugin rejects it, install JDK 21 and point `JAVA_HOME` there.

## 4. Android SDK + NDK

The user needs Android Studio (or the command-line tools) installed, plus an NDK side-by-side install. Then set:

- `ANDROID_HOME` → SDK root (typically `C:\Users\<user>\AppData\Local\Android\Sdk`)
- `NDK_HOME` → a specific NDK version dir like `$ANDROID_HOME\ndk\27.0.12077973` (NOT the parent `ndk` dir)
- `JAVA_HOME` → JDK 21 install path

Verify with:

```pwsh
$env:ANDROID_HOME
$env:NDK_HOME
$env:JAVA_HOME
Test-Path "$env:ANDROID_HOME\platform-tools\adb.exe"
Test-Path "$env:NDK_HOME\source.properties"
```

(`adb` is already on PATH at `C:\platform-tools\adb.exe` — that's a separate copy and is fine for device debugging, but Tauri/Gradle still needs `ANDROID_HOME`.)

## 5. Initialize the Android project

Once 1–4 pass:

```pwsh
npm run tauri android init
```

This generates `src-tauri/gen/android/` — commit it. Re-run only if the Tauri major version changes.

## 6. First run

```pwsh
npm run tauri android dev
```

For a USB device: enable Developer Options + USB debugging, then `adb devices` should list it. For an emulator: launch one via Android Studio AVD Manager first.

## Common failures

- **"NDK not found"** — `NDK_HOME` is pointing at the parent `ndk\` dir instead of a versioned subdir.
- **"JAVA_HOME is set to an invalid directory"** — quote the path if it contains spaces; on Windows use forward slashes or escape backslashes in shell exports.
- **Gradle complains about JDK version** — install JDK 21 alongside, override `JAVA_HOME` for this session only.
- **Build hangs at "Configuring Gradle"** — first run downloads ~1GB. Be patient or check proxy/network.
