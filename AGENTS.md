# AGENTS.md

Small entrypoint for future coding agents. Load only the topic docs needed for the task.

## Project

Pansuthong is a Tauri 2 task tracker for Windows desktop and Android.

- Frontend: React 19 + TypeScript + Vite in `src/`
- Backend: Rust/Tauri in `src-tauri/`
- Rust crate: `pansuthong`; lib: `pansuthong_lib`
- Production id: `net.puetsua.pansuthong`; dev id: `net.puetsua.pansuthong.dev`
- Testing target: `Pansuthong Dev` / `PansuthongDev` only. Never launch, modify data for, uninstall, reset, or otherwise touch the production `Pansuthong` app unless the user explicitly asks.

## Showing the app to the user

When the user asks to "show", "open", "run", "test", or "demonstrate" something in the app, you **must** use the **dev** version (`Pansuthong Dev` / `PansuthongDev`). Never launch, interact with, screenshot, automate, or otherwise touch the production `Pansuthong` app unless the user explicitly asks.

Before touching any Pansuthong process, locate the **production** app's process ID(s) and executable path so you can avoid them:

- Windows: `tasklist /FI "IMAGENAME eq Pansuthong.exe"` (prod) vs `tasklist /FI "IMAGENAME eq Pansuthong Dev.exe"` (dev), then `wmic process where "name='Pansuthong.exe'" get ProcessId,ExecutablePath` for the path.
- Confirm the process name and path before attaching, killing, or driving it via automation (e.g. `agent_browser` / Electron / `taskkill`). If a process matches the production executable path, leave it alone.

Production data and windows are off-limits. If you are unsure whether a window/process is dev or production, ask the user before proceeding.

## Start Here

- Repo map: `docs/llm-navigation.md`
- Data invariants: `docs/agent/data-model.md`
- Change paths and verification: `docs/agent/change-workflow.md`
- Commands and toolchain: `docs/agent/commands-toolchain.md`
- Release notes: `docs/agent/releases.md`

## Non-Negotiables

- Tasks and tags are the product center. Do not reintroduce Projects or another parallel grouping system.
- Settings/data-folder config are device-local, not synced.
- Views are computed queries; do not persist view lists.
- Model changes must be backward-compatible.
- New Settings sections/controls require explicit user approval.
- Use the dev app (`PansuthongDev`) for showing/testing the app; production `Pansuthong` app/data is off-limits. Locate the production PID and path first so it is never modified by accident.
- Preserve unrelated dirty work. Check `git status --short` before edits and before final response.
- Do not recreate `docs/superpowers/` plan/spec artifacts unless explicitly requested.
