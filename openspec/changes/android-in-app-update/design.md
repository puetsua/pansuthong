## Context

Desktop updates use `tauri-plugin-updater` with signed `latest.json` (windows-x86_64 / linux-x86_64). Android CI publishes `Pansuthong_<version>_universal.apk` on GitHub Releases. `checkForUpdate()` currently returns `null` on Android. `UpdatePrompt` already handles offer, download progress, and retry.

See proposal.md for motivation.

## Goals / Non-Goals

**Goals:**

- Telegram-style Android flow: in-app check → download APK to app cache → system installer → user confirms Install.
- Production checks GitHub Releases API for the universal APK on the latest tag; Dev checks a manifest URL from `tauri.dev.conf.json` only.
- Reuse `UpdatePrompt` and pending-update store; failed/offline checks stay silent at startup.
- Same `applicationId` + signing key required for in-place update (Dev and prod are different ids).

**Non-Goals:**

- Silent/replace-without-prompt installs.
- Opening GitHub in a browser as the update path.
- Extending `tauri-plugin-updater` for Android.
- New production Settings control for update URL (Dev URL stays in dev config).
- Play Store in-app updates (document only).
- Observing install success after the system installer (process is killed on success).

## Decisions

### 1. Custom `android-updater` plugin + `tauri-plugin-android-installer`

- **Choice:** Local plugin at `src-tauri/plugins/android-updater` exposes `check` and `download_and_install`. `check` stores the resolved APK URL in plugin state (not exposed to the webview); `download_and_install` uses that stored URL only. Install delegates to `tauri-plugin-android-installer` after APK lands in `appCacheDir`.
- **Why:** Keeps desktop updater untouched; installer plugin already handles FileProvider and `REQUEST_INSTALL_PACKAGES`.
- **Alternatives:** Extend desktop updater (unsupported on Android). Rewrite PackageInstaller sessions (unnecessary).

### 2. Production manifest via GitHub Releases API

- **Choice:** `GET /repos/puetsua/pansuthong/releases/latest`; pick asset matching `Pansuthong_*_universal.apk` (exclude `.sig` and non-APK). Version from release tag; body from release notes.
- **Why:** Desktop `latest.json` is minisign desktop-only; Android needs a separate artifact path anyway.
- **Alternatives:** Dedicated `android-latest.json` on releases (extra release-step; API is sufficient).

### 3. Dev manifest URL in `tauri.dev.conf.json` only

- **Choice:** `plugins.androidUpdater.endpoints: ["http://<host>:8765/android-latest.json"]`. `scripts/serve-android-dev-update.mjs` writes/serves manifest + APK from a local folder.
- **Why:** AGENTS.md forbids new production Settings; Dev id is already dev-config scoped.
- **Format:** `{ "version": "0.2.0", "notes": "...", "url": "http://host:8765/Pansuthong_Dev_0.2.0_universal.apk" }`

### 4. Unified `AppUpdate` type in `updater.ts`

- **Choice:** `checkForUpdate()` returns a small adapter with `version`, `body`, and `downloadAndInstall(onProgress)` — desktop wraps `Update` from plugin-updater; Android wraps plugin commands. `installUpdate` relaunches on desktop only.
- **Why:** `UpdatePrompt` stays one component; no duplicate modal.

### 5. Version compare in Rust (tested) + TS re-export tests

- **Choice:** Semver-style compare in the plugin (`major.minor.patch`, optional prerelease). Unit tests in Rust; TS tests for manifest URL selection helpers if any logic stays in TS.
- **Why:** Single source of truth for "is newer"; issue lists compare tests explicitly.

## Risks / Trade-offs

- **[Risk] `REQUEST_INSTALL_PACKAGES` blocks Play submission** → Document in releases.md; sideload-only for now.
- **[Risk] Install-unknown-apps permission not granted** → After returning from Settings, poll `can_install` briefly; if still denied, return a retry-friendly error for UpdatePrompt.
- **[Risk] GitHub API rate limits** → One check per launch; failures swallowed like desktop.
- **[Risk] Mismatched signing keys** → "App not installed"; document `adb uninstall` + same keystore in verification steps.
- **[Risk] Emulator cannot complete Install tap in CI** → VM tests stop at download/install-launch; phone steps documented.

## Migration Plan

- Ship in next Android release. No data migration.
- Rollback: remove plugin registration and restore Android `null` check.

## Open Questions

- None.
