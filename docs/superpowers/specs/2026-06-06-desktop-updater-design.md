# Desktop in-app updater — design

**Date:** 2026-06-06
**Status:** Approved
**Scope:** Windows desktop only (the Tauri updater does not support Android/iOS).

## Goal

Let the installed Windows desktop app notice when a newer GitHub Release exists,
show the user a prompt with the release notes, and — on confirmation — download,
install, and relaunch into the new version. Android is untouched; it continues to
update via the Play Store / APK re-install.

## Behaviour (agreed UX)

**Auto-check on launch + prompt.** Once on app mount the app silently checks
GitHub for a newer stable release. If one exists, a modal appears showing the new
version and its release notes with **Update now** / **Later** buttons. "Update
now" downloads with a progress indicator, installs, and relaunches. A failed or
offline check is silent — it must never block startup or nag.

Prereleases (`x.y.z-beta.n`) are **not** offered: the endpoint resolves to
GitHub's "latest" release, which excludes prereleases.

## How the Tauri updater works

1. **Signing keypair (minisign).** The updater requires signed updates — not
   optional. A keypair is generated once: the **public key** lives in
   `tauri.conf.json` (`plugins.updater.pubkey`); the **private key + password**
   live in GitHub Secrets (for CI to sign with) plus a backup in
   `_local_secrets/` (same pattern + same "back it up or you can never ship
   updates again" caveat as the Android keystore).

2. **Update manifest (`latest.json`).** CI generates a small JSON file listing
   the new version, notes, `pub_date`, and a per-platform entry containing the
   `.sig` signature and the installer download URL. It is uploaded as a release
   asset. The app's endpoint points at the **stable** URL
   `https://github.com/puetsua/pansutong/releases/latest/download/latest.json`,
   which always resolves to the newest non-prerelease release.

3. **Plugins + flow.** `tauri-plugin-updater` (Rust) + `tauri-plugin-process`
   (Rust) and their JS counterparts. Frontend `check()` → if `Update` returned,
   show dialog → `downloadAndInstall()` → `relaunch()`.

## Components

### Rust (`src-tauri/`)
- **`Cargo.toml`** — add `tauri-plugin-updater` and `tauri-plugin-process` under
  the existing `[target.'cfg(not(any(target_os = "android", target_os = "ios")))'.dependencies]`
  block, so the Android build never pulls them in (per the desktop-only-plugin /
  Android-ACL lesson).
- **`lib.rs`** — register both plugins inside a `#[cfg(desktop)]` builder block.
- **`tauri.conf.json`** — `plugins.updater = { endpoints, pubkey }`; add
  `bundle.createUpdaterArtifacts: true` so the build emits the `.sig`.
- **`capabilities/desktop-updater.json`** — new desktop-only capability
  (`platforms: ["windows","macOS","linux"]`) granting `updater:default` +
  `process:default`. **Not** added to the shared `default.json`, which would
  break the Android ACL build.

### Frontend (`src/`)
- **`src/lib/updater.ts`** — the testable seam:
  - `checkForUpdate(): Promise<Update | null>` — returns `null` on Android (no-op,
    guarded by `isAndroid()`), on "up to date", and on any thrown error (offline).
  - `installUpdate(update, onProgress?)` — wraps `downloadAndInstall`, mapping the
    plugin's `Started`/`Progress`/`Finished` events to a `0..1` fraction, then
    `relaunch()`.
- **`src/components/UpdatePrompt.tsx`** — a modal driven by a small phase state
  machine (`available | downloading | error`). Checks once on mount; renders
  nothing until an update is available. Mounted once in `App.tsx` inside the
  Shell (alongside the reload banner). i18n strings under an `update.*` key.

### CI (`.github/workflows/release.yml`)
- Add `TAURI_SIGNING_PRIVATE_KEY` + `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` to the
  **Windows job** env so the NSIS build produces a signed bundle + `.sig`.
- Expose the git-cliff notes as a `release-notes` job output, and after the build
  generate `latest.json` (version from the tag, notes, the NSIS `.sig` contents,
  and the `releases/download/<tag>/...-setup.exe` URL) and upload it as a release
  asset next to the `-setup.exe`. The Android job is unchanged.

### One-time manual setup
- Generate the keypair (`npm run tauri signer generate`), commit the **pubkey**
  into `tauri.conf.json`, store the private key + password as the two GitHub
  Secrets, and keep a backup in `_local_secrets/`.

## Testing
- **`src/lib/updater.test.ts`** (mocks `@tauri-apps/plugin-updater`,
  `@tauri-apps/plugin-process`, `./platform`):
  - Android → `checkForUpdate` returns `null`, never calls `check()`.
  - `check()` throws → returns `null` (offline swallowed).
  - `check()` resolves an update → returned through.
  - `installUpdate` maps Started/Progress/Finished to fractions and calls
    `relaunch()`.
- **`src/components/UpdatePrompt.test.tsx`** — when a check resolves an update,
  the dialog shows version + notes; "Later" dismisses it; "Update now" installs.
- **Build/static:** `npx tsc --noEmit`, `cargo check`, `cargo check --target
  aarch64-linux-android` (confirm the new desktop deps don't leak into Android),
  `npm test`.

## Out of scope
- Android updates (Play Store / APK).
- Auto-install without prompt; manual "Check for updates" button in Settings.
- Differential/delta updates.
