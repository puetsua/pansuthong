## 1. OpenSpec and plugin scaffold

- [x] 1.1 Add `src-tauri/plugins/android-updater` crate (check, download, install commands) and register it plus `tauri-plugin-android-installer` in `lib.rs`
- [x] 1.2 Add capabilities permissions for `android-updater` and `android-installer` on Android

## 2. Update resolution and config

- [x] 2.1 Implement GitHub Releases check for production (`Pansuthong_*_universal.apk`, ignore `.sig`) and Dev manifest URL in `tauri.dev.conf.json`
- [x] 2.2 Add semver version-compare helper with Rust unit tests (`is_newer`, equal, prerelease)

## 3. Frontend integration

- [x] 3.1 Refactor `updater.ts` with `AppUpdate` adapter; Android uses plugin, desktop unchanged; `installUpdate` skips relaunch on Android
- [x] 3.2 Point `UpdatePrompt` at `AppUpdate` type (no Android null short-circuit)

## 4. Dev tooling and docs

- [x] 4.1 Add `scripts/serve-android-dev-update.mjs` and document phone verification in `docs/agent/releases.md` (Play Store note included)

## 5. Tests and verification

- [x] 5.1 Add TS unit tests: version compare, ignore-when-latest, Dev URL vs production source, reject `.sig` as APK
- [x] 5.2 Run `npm test` and `cargo test --manifest-path src-tauri/Cargo.toml -j 1` for new tests
