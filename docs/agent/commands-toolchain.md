# Commands And Toolchain

## Commands

- `npm run tauri dev` - desktop `Pansuthong Dev` on port 1420; safe testing target
- `npm run tauri android dev` - Android dev id `net.puetsua.pansuthong.dev`; safe testing target
- `npm run tauri build` - desktop build
- `npm run tauri android build` - Android build
- `npm run build` - TypeScript + Vite build
- `npm test` / `npm test -- <name>` - Vitest
- `npm run lint` - ESLint
- `cargo test --manifest-path src-tauri/Cargo.toml -j 1`
- `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`

Use `npm run tauri <subcommand>`, not a global `tauri`.

`gen/android` is one committed Gradle project serving BOTH identifiers: production
(`net.puetsua.pansuthong`, CI release) and dev (`net.puetsua.pansuthong.dev`, local
testing). `app/build.gradle.kts` reads the CLI-generated
`src/main/assets/tauri.conf.json` to pick applicationId/namespace/label/activity and to
exclude the inactive identifier's Kotlin sources; `scripts/tauri.mjs` deletes the
inactive identifier's `generated/` tree before Android builds so tauri's build script
regenerates `TauriActivity.kt` for the active one (tauri has no rerun-if-env-changed
for the kotlin out dir). Never delete + re-init `gen/android` for one identifier; keep
both `MainActivity.kt` variants. Always build through `npm run tauri`, not a bare
`tauri` CLI, or the generated-tree cleanup is skipped.

Do not touch the production app (`Pansuthong`, `net.puetsua.pansuthong`) during testing. Use only `Pansuthong Dev` / `PansuthongDev` (`net.puetsua.pansuthong.dev`) unless the user explicitly asks for production work.

## Machine Toolchain

Configured as of 2026-05-29:

- `JAVA_HOME=C:\Program Files\Android\Android Studio1\jbr`
- `ANDROID_HOME=C:\Data\Android`
- `NDK_HOME=C:\Data\Android\ndk\28.2.13676358`
- Rust desktop and Android targets installed.
- No CLI `sdkmanager`/`avdmanager`; use Android Studio GUI for SDK/AVD.
- Restart Codex after env var changes.

Known Windows friction: `spawn EPERM`, `.git/index.lock`, and Rust target-dir locks. Retry once; use an alternate Rust target dir when appropriate.
