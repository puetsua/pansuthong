# Priority becomes a tag attribute (issues #4 + #6)

Date: 2026-05-30
Status: Approved-by-default under the session goal directive ("finish #4 and #6", autonomous). User said "stop asking and finish it all."

## Problem

- **Issue #4** — priority is a per-task enum rendered only as a thin color stripe; it has no tag-like (chip) representation and reads inconsistently with tags.
- **Issue #6** — a tag's name and color cannot be edited after creation (only its project link / delete). Backend `update_tag` already supports name+color; the UI is missing.

## Decision (from brainstorming)

Priority stops being a per-task field. **Each tag carries an integer weight** (`-9999..=9999`, default `0`). A task's priority is *derived*:

```
effectivePriority(task) = max(weight of task's tags), or 0 if it has no tags
```

Negative-weighted tags sink a task **below** untagged ones. This mirrors how project/Inbox membership is already derived from tags (`model.rs:120-136`) — the "tags-over-projects" direction.

The `!`/`!!`/`!!!` composer shortcut is **deprecated/removed**; those characters become ordinary title text.

## Data model

**Rust (`src-tauri/src/model.rs`)**
- `Tag` gains `#[serde(default)] pub priority: i64` (default 0).
- `Task.priority` field **removed**; `Priority` enum **removed**.
- `Settings` gains `sort_order: String` (`"priority" | "date"`, default `"priority"`), with `#[serde(default = ...)]` so old files load.
- `CURRENT_VERSION` → `2`.

**TS (`src/lib/tauri.ts`)**
- `Tag` gains `priority: number`.
- Remove `Priority` type, `Task.priority`, `TaskUpdate.priority`, `parseComposer().priority`.
- `Settings` gains `sort_order: "priority" | "date"`.

## Migration / backward-compat

Rely on serde defaults — no destructive migration code:
- Old `tasks.json`: a task's old `"priority"` is silently ignored (serde drops unknown fields); old tags default to `priority: 0`; missing `sort_order` defaults to `"priority"`.
- **Existing per-task priority values are intentionally discarded** — there is no per-task priority concept after this change. This is the only data loss, and it is inherent to the redesign.
- `CURRENT_VERSION` bump to 2 documents the schema change.

## Parsing & composer

- `parse.rs` / `state/parse.ts`: remove `leading_bang_priority` and `ParsedInput.priority`. `!`-prefixed tokens fall through to the title.
- `ComposerPreview` drops the priority chip; `Composer`/`QuickCapture` stop passing `priority` to `add_task`.

## Sorting (configurable)

- New setting `sort_order` with two modes:
  - **Priority** (default): `weight desc → date → insertion`.
  - **Date**: `date → weight desc → insertion`.
- Sort-date key = earliest of `scheduled_date`/`due_date`; undated tasks sort after dated ones.
- Applied centrally in `buildIndexes(doc)` (it already has `doc.settings` + tags), so `today`/`inbox`/`byTag`/`byProject` come out pre-sorted; views are untouched. Date-grouped Upcoming sorts within each date group.
- JS `Array.prototype.sort` is stable, so "insertion order" is preserved as the final tiebreak.

## UI

- **`TaskRow` (issue #4)**: render **all** of a task's tags as chips, **ordered by weight desc**; remove the `task-pri` stripe + `priColor`. Chips keep each tag's own color; the weight number is not printed (ordering conveys it).
- **`TaskEditor`**: remove the priority `<select>` + `PRIORITIES`; tag toggles remain (ordered by weight).
- **`TagManager` (issue #6)**: each row gets an **inline edit mode** reusing `ProjectColorPicker` + a name input + a weight number input (`-9999..9999`), saved via `api.updateTag({ name, color, priority })`. The "add tag" form also gains a weight input.
- **`SettingsView`**: a "Sort order" control (Priority / Date) beside Theme.
- **`Sidebar`** and tag lists: order tags by weight desc then name (coherence; minor).
- CSS: remove now-dead `.task-pri` and `.composer-chip.pri-*` rules.

## Backend command changes (`commands.rs`)

- `NewTaskInput` / `add_task` / `UpdateTaskInput` / `update_task`: drop `priority`.
- `NewTagInput` / `add_tag`: add `priority: i64` (serde default 0).
- `UpdateTagInput` / `update_tag`: add `priority: Option<i64>`.
- `UpdateSettingsInput` / `update_settings`: add `sort_order: Option<String>`.
- `api.addTag(name, color, priority, project_id?)`, `api.updateTag({ …, priority? })`, `api.updateSettings({ …, sortOrder? })`.

## Testing

- **Rust**: drop priority cases in `parse_integration.rs`; add tag-weight (de)serialization, `update_tag` priority, and effective-priority/sort tests; audit `conflict.rs` / `search.rs` / `sync.rs` and Rust fixtures for `priority` refs.
- **TS**: drop priority from `parse.test.ts` / `taskUpdate.test.ts`; add a sort / effective-priority test; update `src/tests/fixtures/sample.json` (remove task priority, add tag weights).
- Gate: `npx tsc --noEmit`, frontend tests (vitest), `cargo test` (in `src-tauri/`), `npm run build`.

## Scope

**In**: everything above — #4 (priority surfaced as weighted tag chips) and #6 (tag name/color editing, now also weight).
**Out**: filtering UI by weight, drag-to-reorder, per-view sort overrides.
