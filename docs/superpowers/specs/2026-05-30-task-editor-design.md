# Task editor modal — design

**Date:** 2026-05-30
**Issues:** #1 (no edit UI), #2 (delete too easy), #3 (move completion control to the right)
**Platform:** Desktop (Windows) primary; modal must remain usable on the mobile shell.

## Problem

A task is immutable once created. The backend already exposes `update_task`
(`src-tauri/src/commands.rs`) and `api.updateTask` (`src/lib/tauri.ts`), but no
component calls it. A row's only actions are toggle-done and a one-click,
unconfirmed `×` delete. Three related issues:

- **#1** — no way to edit a task's title, dates, priority, tags, or notes.
- **#2** — delete is a single unconfirmed click on the row; too easy to do by accident.
- **#3** — the completion checkbox sits on the left; it should be on the right.

## Goals

1. Editing any task field from the UI, wired to the existing `update_task` command.
2. Fix the latent backend bug that prevents *clearing* an optional field.
3. Move delete into the editor, behind a confirmation.
4. Move the completion checkbox to the right side of the row.

## Non-goals (YAGNI)

- Creating brand-new tags from inside the editor (stays in the composer / settings).
- Undo for delete.
- A bespoke mobile editor layout beyond the modal being responsive.

## Approach

A new **`TaskEditor`** modal opened by clicking anywhere on a `TaskRow` (except the
completion checkbox). One small, dependency-free backend fix unblocks field-clearing.
No routing or state-store changes — the existing `store-changed` event already triggers
a document reload after any mutation, so the list refreshes automatically.

### Backend — fix double-`Option` field clearing (`src-tauri/src/commands.rs`)

`UpdateTaskInput` already models `due_date`/`scheduled_date`/`priority` as
`Option<Option<_>>` to distinguish "field absent → don't change" from "field is null →
clear it". With default serde, both `{}` and `{"due_date": null}` deserialize to `None`,
so clearing is impossible (see the existing Phase-2 NOTE comment at `commands.rs:62`).

Fix with the standard plain-serde "double option" helper — **no new crate**:

```rust
fn double_option<'de, T, D>(de: D) -> Result<Option<Option<T>>, D::Error>
where
    T: serde::Deserialize<'de>,
    D: serde::Deserializer<'de>,
{
    Option::<T>::deserialize(de).map(Some)
}
```

Annotate the three fields:

```rust
#[serde(default, deserialize_with = "double_option")] pub due_date: Option<Option<NaiveDate>>,
#[serde(default, deserialize_with = "double_option")] pub scheduled_date: Option<Option<NaiveDate>>,
#[serde(default, deserialize_with = "double_option")] pub priority: Option<Option<Priority>>,
```

Resulting semantics:

| Payload                       | Deserializes to | Effect            |
|-------------------------------|-----------------|-------------------|
| field absent                  | `None`          | leave unchanged   |
| `"due_date": null`            | `Some(None)`    | clear the field   |
| `"due_date": "2026-06-01"`    | `Some(Some(d))` | set the field     |

The existing `update_task` body already does the right thing once deserialization
distinguishes these cases. Replace the now-stale Phase-2 NOTE comment.

### Frontend

**`TaskRow.tsx`** — reworked for #3 + the edit/delete trigger:

- New left→right order: priority stripe → title → tag → when-label → **completion
  checkbox (now rightmost)**. The `×` delete button is **removed** (moves into the editor).
- The row body is clickable (`onClick` opens the editor). The checkbox stops propagation
  (`onClick={e => e.stopPropagation()}`) so toggling done never opens the editor.
- Accessibility: row gets `role="button"`, `tabIndex={0}`, and an `onKeyDown` that opens
  the editor on Enter/Space. The checkbox keeps its own `aria-label`.
- TaskRow owns `const [editing, setEditing] = useState(false)`; when true it renders
  `<TaskEditor task={task} allTags={tags} onClose={() => setEditing(false)} />`.
  (`tags` is already `indexes.tagsById` — the full tag map.)

**`TaskEditor.tsx`** — new component (the #1 panel, home of #2's delete):

- Rendered via `createPortal` to `document.body`: a centered modal over a backdrop.
  Closes on backdrop click, Esc, Cancel, or after a successful Save/Delete.
- Local form state seeded from the task. Structured fields:
  - **Title** — text input (required; non-empty enforced before save).
  - **Scheduled** / **Due** — two `<input type="date">`; native value is `YYYY-MM-DD`,
    matching storage. Empty input → send `null` (clear).
  - **Priority** — `<select>`: none / low / med / high. "none" → send `null`.
  - **Tags** — toggle chips/checkboxes over `allTags`; selection writes `tag_ids`.
  - **Notes** — `<textarea>`.
- **Save** → `api.updateTask({ id, title, scheduled_date, due_date, priority, notes,
  tag_ids })`, sending every field explicitly (null to clear). On error, inline message
  reusing the `composer-error` style.
- **Delete** (#2) → `window.confirm('Delete "<title>"? …')`, then `api.deleteTask(id)`
  and close — consistent with the existing confirm in `TagManager`.

**Form → payload mapping** is extracted to a pure helper (e.g. `buildTaskUpdate`) so the
clearing/setting logic is unit-testable without a component-render harness.

### Styling (`src/styles/global.css`)

Add modal/backdrop classes (`.modal-backdrop`, `.task-editor`, field rows) and adjust
`.task-row` so the checkbox sits on the right and the row reads as clickable
(cursor/hover). Reuse existing tokens from `tokens.css`.

## Testing

- **Rust** (command tests): assert `UpdateTaskInput` deserialization for all three cases —
  omitted field leaves value unchanged, explicit `null` clears, value sets. This is the
  core correctness fix and is pure and fast.
- **Frontend** (`src/**/*.test.ts`): unit-test the pure `buildTaskUpdate` mapping
  (clearing vs setting each field). No new component-test framework is introduced; the
  React component stays a thin shell around the tested helper.
- **Type-check**: `npx tsc --noEmit`.
- **Manual** (`npm run tauri dev` on Windows): open a task by clicking its row, change
  title/dates/priority/tags/notes, clear a date, save; delete from the panel (confirm
  prompt); confirm the checkbox toggles done from the right without opening the editor.

## Risks / notes

- `createPortal` + Esc/backdrop handling is new to this codebase; keep listeners scoped
  to the editor's lifetime (effect cleanup) to avoid leaks across rows.
- The modal must not trap the row's click: checkbox uses `stopPropagation`; the (now
  removed) delete button is no longer a concern.
