## Why

Android users sideload Pansuthong from GitHub Releases but must manually download and install each new APK. Desktop already offers an in-app update prompt; Android silently skips the check today. Issue #181 asks for a Telegram-style flow: check in-app, download the APK, launch the system installer, user taps Install once.

## What Changes

- Add a custom `android-updater` Tauri plugin (`src-tauri/plugins/android-updater`) for check, download, and install on Android. Do not extend `tauri-plugin-updater` (desktop-only).
- Reuse `tauri-plugin-android-installer` for the system install intent after download.
- Reuse the existing `UpdatePrompt` UI on Android; `checkForUpdate()` stops returning `null` on Android.
- Production (`net.puetsua.pansuthong`): resolve updates from GitHub Releases (`Pansuthong_*_universal.apk` asset on the latest release). Dev APKs are not published to GitHub releases.
- Dev (`net.puetsua.pansuthong.dev`): update manifest URL only in `tauri.dev.conf.json`; local `scripts/serve-android-dev-update.mjs` serves `android-latest.json` plus a Dev APK folder (APKs not committed).
- Document Play Store constraint: future Play builds must not ship `REQUEST_INSTALL_PACKAGES` and must use Play In-App Updates instead.
- Unit tests for version compare, ignore-when-latest, Dev URL vs production GitHub, and rejecting `.sig` as an APK.

## Capabilities

### New Capabilities

- `android-updater`: Android in-app update check, APK download with progress, and system installer launch for sideload builds.

### Modified Capabilities

- `desktop-updater`: Android no longer silently skips the startup update check; desktop behavior (signed `latest.json`, minisign) is unchanged.

## Impact

- New local plugin crate at `src-tauri/plugins/android-updater`; dependency on `tauri-plugin-android-installer`.
- `src/lib/updater.ts`, `UpdatePrompt`, capabilities, `tauri.dev.conf.json`.
- `scripts/serve-android-dev-update.mjs` for Dev manual verification.
- `docs/agent/releases.md` — Android update verification notes.
- GitHub issue: https://github.com/puetsua/pansuthong/issues/181
