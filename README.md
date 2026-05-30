# Pansutong

A minimal cross-platform task tracker built with Tauri 2. Targets Windows desktop and Android from a single codebase.

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
