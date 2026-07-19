# Commands And Toolchain

## Commands

- `npm run tauri dev` - desktop `Pansuthong Dev` on port 1420; safe testing target
- `npm run tauri android dev` - Android dev id `net.puetsua.pansutong.dev`; safe testing target
- `npm run tauri build` - desktop build
- `npm run tauri android build` - Android build
- `npm run build` - TypeScript + Vite build
- `npm test` / `npm test -- <name>` - Vitest
- `npm run lint` - ESLint
- `cargo test --manifest-path src-tauri/Cargo.toml -j 1`
- `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`

Use `npm run tauri <subcommand>`, not a global `tauri`.

Do not touch the production app (`Pansuthong`, `net.puetsua.pansutong`) during testing. Use only `Pansuthong Dev` / `PansuthongDev` (`net.puetsua.pansutong.dev`) unless the user explicitly asks for production work.

## Machine Toolchain

Configured as of 2026-05-29:

- `JAVA_HOME=C:\Program Files\Android\Android Studio1\jbr`
- `ANDROID_HOME=C:\Data\Android`
- `NDK_HOME=C:\Data\Android\ndk\28.2.13676358`
- Rust desktop and Android targets installed.
- No CLI `sdkmanager`/`avdmanager`; use Android Studio GUI for SDK/AVD.
- Restart Codex after env var changes.

Known Windows friction: `spawn EPERM`, `.git/index.lock`, and Rust target-dir locks. Retry once; use an alternate Rust target dir when appropriate.
