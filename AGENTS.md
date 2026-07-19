# AGENTS.md

Small entrypoint for future coding agents. Load only the topic docs needed for the task.

## Project

Pansuthong is a Tauri 2 task tracker for Windows desktop and Android.

- Frontend: React 19 + TypeScript + Vite in `src/`
- Backend: Rust/Tauri in `src-tauri/`
- Rust crate: `pansutong`; lib: `pansutong_lib`
- Production id: `net.puetsua.pansutong`; dev id: `net.puetsua.pansutong.dev`
- Testing target: `Pansuthong Dev` / `PansuthongDev` only. Never launch, modify data for, uninstall, reset, or otherwise touch the production `Pansuthong` app unless the user explicitly asks.

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
- Use the dev app for testing; production app/data is off-limits.
- Preserve unrelated dirty work. Check `git status --short` before edits and before final response.
- Do not recreate `docs/superpowers/` plan/spec artifacts unless explicitly requested.
