## 1. Desktop plugin

- [x] 1.1 Add `tauri-plugin-single-instance = "2"` to the desktop-only target deps in `src-tauri/Cargo.toml` (not Android)
- [x] 1.2 Register the plugin as the first plugin on the desktop `tauri::Builder`, with a callback that `unminimize`s, `show`s, and `set_focus`es the `"main"` webview (on Windows, briefly `set_always_on_top(true/false)` after that sequence)

## 2. Verify

- [x] 2.1 `cargo test --manifest-path src-tauri/Cargo.toml -j 1` and `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings` are clean
- [x] 2.2 Manual desktop smoke on `Pansuthong Dev` only: second launch focuses the existing window; a minimized window is restored; do not launch or touch production `Pansuthong`
