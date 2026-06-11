# Change Workflow

## Common Edits

- Tauri command: `commands.rs` -> `lib.rs` handler -> `src/lib/tauri.ts` -> tests.
- Synced field: `model.rs` -> `src/lib/tauri.ts` -> `schemas/tasks.schema.json` -> fixtures/tests.
- UI text: update both locale files.
- View behavior: prefer `src/state/indexes.ts`; reuse `ArchivedView` for filters/pagination.
- Editor modals: `TaskEditor` and `TagEditor` backdrop clicks are inert.
- Settings screen: do not add a new section/control without explicit approval.

## Verify By Scope

- Frontend focused: `npm test -- <name>`
- Frontend broad: `npm test`, `npm run build`, `npm run lint`
- Rust: `cargo test --manifest-path src-tauri/Cargo.toml -j 1`
- Rust lint: `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`
- Manual desktop: `npm run tauri dev`
- Manual Android: `npm run tauri android dev`

## Git

- Check `git status --short` before edits and final response.
- Preserve unrelated dirty work.
- Use a branch/worktree when local `main` is dirty or diverged.
- Temp worktree convention: `.claude/worktrees/`.
- If GitHub connector fails for `puetsua/pansutong`, use `gh` directly.
