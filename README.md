# Pansutong

A minimal cross-platform task tracker built with Tauri 2. Targets Windows desktop and Android from a single codebase.

## Install

Grab the latest build from the [**Releases**](https://github.com/puetsua/pansutong/releases/latest) page.

**Windows** — download `Pansutong_<version>_x64-setup.exe` and run it. It's a per-user installer, so no administrator rights are needed.

**Android** — download `Pansutong_<version>_universal.apk`, copy it to your device, and open it. You'll need to allow installing from unknown sources when prompted. The APK is signed, so it installs and updates normally; it is not on the Play Store.

## Stack
- Tauri 2 (Rust core)
- React + TypeScript + Vite (frontend)
- File-based JSON persistence in the app data directory (works on both desktop and mobile)

## Quick start

```bash
npm install
npm run tauri dev          # desktop (Windows)
npm run tauri android dev  # Android (emulator or USB device)
```

See [CLAUDE.md](./CLAUDE.md) for prerequisites and project conventions.

## License

Licensed under the [Creative Commons Attribution-NonCommercial 4.0 International License (CC BY-NC 4.0)](https://creativecommons.org/licenses/by-nc/4.0/). You may share and adapt the work for **non-commercial** purposes with attribution; **commercial use is not permitted**. See [LICENSE](./LICENSE) for the full text.
