# Releases

- Use Conventional Commits.
- Release tags are plain semver, no `v` prefix.
- `.github/workflows/release.yml` builds Windows NSIS, Linux AppImage + .deb, and Android APK.
- Desktop updater uses signed `latest.json` with windows-x86_64 and linux-x86_64 platform entries.
- Linux updater artifact is the signed AppImage (`*.AppImage` plus `.sig`). Older Tauri builds may emit `*.AppImage.tar.gz` instead; the release script prefers the tarball when present. A `.deb` install will not in-app update in place.
- Required secrets: `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
- Keep the updater private key backup safe; losing it prevents verifiable updates.
- Installer/update taskbar-pin behavior depends on `src-tauri/windows/hooks.nsh`; verify with a real Windows install if touching installer config.

## SQLite store migration (desktop)

- First launch on the SQLite build migrates `tasks_<device>.json` (and legacy `tasks.json`) into `tasks_<device>.db` and leaves the JSON files in place as a downgrade fallback.
- The new build stops writing the JSON replica, so an older build no longer sees this device's *new* edits — upgrade all of a user's desktop devices together, and keep the JSON fallback for a retention window (a few releases) before a later change drops JSON writes.
- Android SAF push/pull uses `tasks_<device>.db` replicas (and still reads legacy JSON peers); live PC↔phone round-trip through a shared folder should be verified on device after install.
