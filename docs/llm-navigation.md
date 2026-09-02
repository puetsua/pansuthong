# LLM Navigation

Load this file after `AGENTS.md`; then open only the topic doc needed.

## Topic Docs

- `docs/agent/data-model.md` - synced model, settings, view invariants
- `docs/agent/repo-map.md` - frontend/Rust file ownership
- `docs/agent/change-workflow.md` - common edit paths, tests, git workflow
- `docs/agent/commands-toolchain.md` - commands, Android/desktop toolchain
- `.grok/hooks/protect-production.mjs` - PreToolUse hook that blocks touching the production app
- `docs/agent/releases.md` - release and updater notes

## Highest-Value Files

- `src-tauri/src/model.rs` - durable Rust model
- `src/lib/tauri.ts` - TS wire types and API wrappers
- `src/state/indexes.ts` - derived views and sorting
- `src-tauri/src/commands.rs` - validation and mutations
- `src-tauri/src/lib.rs` - app setup and command registration
- `src-tauri/tauri.dev.conf.json` - `Pansuthong Dev` testing app config
- `schemas/tasks.schema.json` - external `tasks.json` contract

`docs/superpowers/` was removed; it held generated planning artifacts, not durable navigation docs.
