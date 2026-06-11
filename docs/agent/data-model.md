# Data Model

- Synced data is `Document` in `src-tauri/src/model.rs`, mirrored in `src/lib/tauri.ts`, stored as `tasks.json`.
- Device-local config is `config.json` in `src-tauri/src/config.rs`; settings and data-folder choice are not synced.
- Tasks reference tags through `tag_ids`; tags do not own tasks.
- Tags are flat and carry `priority`; task priority is derived from max tag weight.
- `Task.completed_at` is the source of truth for done and archived state.
- Templates live in `template_tasks`, not `tasks`.
- Views are computed from tasks/tags/templates, mainly in `src/state/indexes.ts`.
- Keep model changes backward-compatible with serde defaults, aliases, optional TS keys, schema updates, and tests.
