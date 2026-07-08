# Releases

- Use Conventional Commits.
- Release tags are plain semver, no `v` prefix.
- `.github/workflows/release.yml` builds Windows installer and Android APK.
- Windows updater uses signed `latest.json`.
- Required secrets: `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
- Keep the updater private key backup safe; losing it prevents verifiable updates.
- Installer/update taskbar-pin behavior depends on `src-tauri/windows/hooks.nsh`; verify with a real Windows install if touching installer config.

## SQLite store migration (desktop)

- First launch on the SQLite build migrates `tasks_<device>.json` (and legacy `tasks.json`) into `tasks_<device>.db` and leaves the JSON files in place as a downgrade fallback.
- The new build stops writing the JSON replica, so an older build no longer sees this device's *new* edits — upgrade all of a user's desktop devices together, and keep the JSON fallback for a retention window (a few releases) before a later change drops JSON writes.
- Android still syncs via JSON over SAF until the SAF layer is converted (`safsync.rs`, change `sqlite-data-store` group 6), so a PC and phone won't yet interoperate through the same folder.
