## 1. Frontend removal

- [x] 1.1 Delete `quick-capture.html` and the `src/quick-capture/` directory (`main.tsx`, `QuickCapture.tsx`, `quick-capture.css`)
- [x] 1.2 Remove the `quick-capture` entry from `vite.config.ts` `rollupOptions.input`
- [x] 1.3 Remove `quickCapture.*` strings from `src/i18n/locales/en.json` and `zh-TW.json`

## 2. Tauri / desktop backend removal

- [x] 2.1 Remove the `tauri-plugin-global-shortcut` plugin registration and handler from `src-tauri/src/lib.rs`
- [x] 2.2 Remove quick-capture `WebviewWindowBuilder` setup and Ctrl+Shift+N registration from desktop `setup`
- [x] 2.3 Remove the main-window `Destroyed` → `exit(0)` handler and the window-state denylist entry for `quick-capture`
- [x] 2.4 Delete `src-tauri/capabilities/quick-capture.json`
- [x] 2.5 Remove `tauri-plugin-global-shortcut` from `src-tauri/Cargo.toml` and refresh the lockfile

## 3. Docs + leftover references

- [x] 3.1 Update `docs/agent/repo-map.md` to drop the Quick Capture second-entry note
- [x] 3.2 Grep the repo for `quick-capture`, `quickCapture`, `QuickCapture`, and `global_shortcut` / `global-shortcut`; clear any remaining product references (leave this change’s OpenSpec artifacts)

## 4. Verify

- [x] 4.1 Confirm frontend/typecheck or relevant unit tests still pass (Composer / `parseComposer` unchanged)
- [x] 4.2 Smoke on **Pansutong Dev** (desktop): main window launches; Composer still adds tasks; Ctrl+Shift+N does not open a capture window; closing the main window exits the process
