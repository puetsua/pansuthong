# Pansuthong

A minimal cross-platform task tracker built with Tauri 2. Targets Windows desktop and Android from a single codebase.

## Install

Grab the latest build from the [**Releases**](https://github.com/puetsua/pansutong/releases/latest) page.

**Windows** — download `Pansuthong_<version>_x64-setup.exe` and run it. It's a per-user installer, so no administrator rights are needed.

**Android** — download `Pansuthong_<version>_universal.apk`, copy it to your device, and open it. You'll need to allow installing from unknown sources when prompted. The APK is signed, so it installs and updates normally; it is not on the Play Store.

## Stack
- Tauri 2 (Rust core)
- React + TypeScript + Vite (frontend)
- File-based JSON persistence in the app data directory (works on both desktop and mobile)

## Quick start

```bash
npm install
npm run tauri dev          # desktop (Windows), dev identifier net.puetsua.pansutong.dev
npm run tauri android dev  # Android (emulator or USB device), dev identifier net.puetsua.pansutong.dev
```

See [CLAUDE.md](./CLAUDE.md) for prerequisites and project conventions.

## License

Licensed under the [Functional Source License, Version 1.1, MIT Future License (FSL-1.1-MIT)](./LICENSE).

The intent, in plain language:

- **Use it personally** — free, no strings attached.
- **Use it at work** — internal use is fine, at a company of any size.
- **Modify it and share it** — forks and redistribution are fine, as long as the license and copyright notices come along.
- **Don't sell it as a product** — you may not offer Pansuthong, or anything substantially similar built from it, as a commercial product or service.
- **Each release becomes MIT after two years** — on the second anniversary of a release, that release automatically converts to the plain [MIT license](https://opensource.org/license/mit), with no restrictions at all.

See [LICENSE](./LICENSE) for the full, governing text, and [fsl.software](https://fsl.software) for background on the license.
