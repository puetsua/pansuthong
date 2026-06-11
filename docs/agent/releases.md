# Releases

- Use Conventional Commits.
- Release tags are plain semver, no `v` prefix.
- `.github/workflows/release.yml` builds Windows installer and Android APK.
- Windows updater uses signed `latest.json`.
- Required secrets: `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
- Keep the updater private key backup safe; losing it prevents verifiable updates.
- Installer/update taskbar-pin behavior depends on `src-tauri/windows/hooks.nsh`; verify with a real Windows install if touching installer config.
