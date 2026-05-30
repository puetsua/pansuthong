# Task Editor Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users edit any task field in a modal opened by clicking a task row; move delete into that modal behind a confirmation (#2) and move the completion checkbox to the right side of the row (#3).

**Architecture:** A dependency-free backend serde fix lets `update_task` clear optional fields. A pure `buildTaskUpdate` helper maps form state to the command payload. A new `TaskEditor` portal modal hosts the structured fields and the delete action. `TaskRow` is reworked: the row body opens the editor, the checkbox moves right and stops event propagation. The existing `store-changed` event reloads the document, so no store changes are needed.

**Tech Stack:** Rust + serde (Tauri commands), React 19 + TypeScript, Vitest, plain CSS with existing tokens.

---

## File Structure

- `src-tauri/src/commands.rs` — add `double_option` deserializer, annotate `UpdateTaskInput` fields, replace the stale Phase-2 NOTE, add a `#[cfg(test)]` module.
- `src/lib/tauri.ts` — add `TaskUpdate` type; widen `api.updateTask` to accept nullable fields.
- `src/state/taskUpdate.ts` (create) — `EditorForm` type + pure `buildTaskUpdate`.
- `src/state/taskUpdate.test.ts` (create) — unit tests for `buildTaskUpdate`.
- `src/components/TaskEditor.tsx` (create) — the modal.
- `src/components/TaskRow.tsx` — rework layout + open editor.
- `src/styles/global.css` — modal styles; row clickable; drop dead `.task-delete` rules.

---

## Task 1: Backend — let `update_task` clear optional fields

**Files:**
- Modify: `src-tauri/src/commands.rs` (import line 9; `UpdateTaskInput` at 69-78; NOTE comment at 62-68; append test module at end)

- [ ] **Step 1: Write the failing test**

Append to the end of `src-tauri/src/commands.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn update_task_input_absent_field_stays_none() {
        let v: UpdateTaskInput = serde_json::from_str(r#"{"id":"t_1"}"#).unwrap();
        assert_eq!(v.due_date, None);
        assert_eq!(v.scheduled_date, None);
        assert_eq!(v.priority, None);
    }

    #[test]
    fn update_task_input_null_field_clears() {
        let v: UpdateTaskInput =
            serde_json::from_str(r#"{"id":"t_1","due_date":null,"priority":null}"#).unwrap();
        assert_eq!(v.due_date, Some(None));
        assert_eq!(v.priority, Some(None));
    }

    #[test]
    fn update_task_input_value_sets_field() {
        let v: UpdateTaskInput =
            serde_json::from_str(r#"{"id":"t_1","due_date":"2026-06-01","priority":"high"}"#).unwrap();
        assert_eq!(v.due_date, Some(Some(NaiveDate::from_ymd_opt(2026, 6, 1).unwrap())));
        assert_eq!(v.priority, Some(Some(Priority::High)));
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml update_task_input`
Expected: `update_task_input_null_field_clears` FAILS — assertion `Some(None)` vs `None` (default serde collapses missing and null). The other two pass.

- [ ] **Step 3: Add the `double_option` deserializer and import**

Change the import at `commands.rs:9` from:

```rust
use serde::Deserialize;
```
to:
```rust
use serde::{Deserialize, Deserializer};
```

Add this helper immediately above the `UpdateTaskInput` struct (just before the current NOTE comment block at line 62):

```rust
/// Lets an optional field distinguish "absent" from an explicit JSON `null`.
/// With `#[serde(default, deserialize_with = "double_option")]`:
///   absent -> None (leave unchanged); null -> Some(None) (clear); value -> Some(Some(v)) (set).
fn double_option<'de, T, D>(de: D) -> std::result::Result<Option<Option<T>>, D::Error>
where
    T: Deserialize<'de>,
    D: Deserializer<'de>,
{
    Option::<T>::deserialize(de).map(Some)
}
```

(Note: fully-qualified `std::result::Result` because this file aliases `Result` to the one-arg crate result via `use crate::error::{AppError, Result};`.)

- [ ] **Step 4: Replace the stale NOTE comment and annotate the fields**

Replace the entire NOTE block (`commands.rs:62-68`) and the `UpdateTaskInput` struct (`69-78`) with:

```rust
// `due_date`, `scheduled_date`, and `priority` are `Option<Option<_>>` decoded with the
// `double_option` deserializer above, so the edit UI can distinguish "field absent
// (don't change)" from "field is null (clear it)".
#[derive(Deserialize)]
pub struct UpdateTaskInput {
    pub id: String,
    #[serde(default)] pub title: Option<String>,
    #[serde(default, deserialize_with = "double_option")] pub due_date: Option<Option<NaiveDate>>,
    #[serde(default, deserialize_with = "double_option")] pub scheduled_date: Option<Option<NaiveDate>>,
    #[serde(default, deserialize_with = "double_option")] pub priority: Option<Option<Priority>>,
    #[serde(default)] pub notes: Option<String>,
    #[serde(default)] pub tag_ids: Option<Vec<String>>,
}
```

The `update_task` body (`80-101`) is unchanged — it already maps `Some(v) => t.field = v`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml update_task_input`
Expected: all three PASS.

Do **not** run `cargo fmt` (the repo uses an intentional aligned style).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/commands.rs
git commit -m "Fix update_task field clearing with double-option serde (#1)"
```

---

## Task 2: Frontend — `TaskUpdate` type + pure `buildTaskUpdate` helper

**Files:**
- Modify: `src/lib/tauri.ts` (add type near line 32; change `updateTask` at line 58)
- Create: `src/state/taskUpdate.ts`
- Create: `src/state/taskUpdate.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/state/taskUpdate.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildTaskUpdate, EditorForm } from "./taskUpdate";

const base: EditorForm = {
  title: "Write report",
  scheduled_date: "",
  due_date: "",
  priority: "",
  notes: "",
  tag_ids: [],
};

describe("buildTaskUpdate", () => {
  it("trims the title", () => {
    expect(buildTaskUpdate("t_1", { ...base, title: "  hi  " }).title).toBe("hi");
  });

  it("clears empty date and priority to null", () => {
    const p = buildTaskUpdate("t_1", base);
    expect(p.due_date).toBeNull();
    expect(p.scheduled_date).toBeNull();
    expect(p.priority).toBeNull();
  });

  it("sets provided date and priority", () => {
    const p = buildTaskUpdate("t_1", { ...base, due_date: "2026-06-01", priority: "high" });
    expect(p.due_date).toBe("2026-06-01");
    expect(p.priority).toBe("high");
  });

  it("passes through notes and tag_ids and id", () => {
    const p = buildTaskUpdate("t_9", { ...base, notes: "n", tag_ids: ["tag_a"] });
    expect(p.id).toBe("t_9");
    expect(p.notes).toBe("n");
    expect(p.tag_ids).toEqual(["tag_a"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/state/taskUpdate.test.ts`
Expected: FAIL — cannot resolve `./taskUpdate` (module not created yet).

- [ ] **Step 3: Add the `TaskUpdate` type to `tauri.ts`**

In `src/lib/tauri.ts`, add after the `Task` type (after line 32):

```ts
export type TaskUpdate = {
  id: string;
  title?: string;
  due_date?: string | null;
  scheduled_date?: string | null;
  priority?: Priority | null;
  notes?: string;
  tag_ids?: string[];
};
```

Change the `updateTask` line (currently line 58) from:

```ts
  updateTask:    (input: Partial<Task> & { id: string })    => invoke<Task>("update_task", { input }),
```
to:
```ts
  updateTask:    (input: TaskUpdate)                         => invoke<Task>("update_task", { input }),
```

- [ ] **Step 4: Create the helper**

Create `src/state/taskUpdate.ts`:

```ts
import { Priority, TaskUpdate } from "../lib/tauri";

export type EditorForm = {
  title: string;
  scheduled_date: string;   // "" = none
  due_date: string;         // "" = none
  priority: "" | Priority;  // "" = none
  notes: string;
  tag_ids: string[];
};

/** Map editor form state to an update_task payload. Empty date/priority => null (clear). */
export function buildTaskUpdate(id: string, form: EditorForm): TaskUpdate {
  return {
    id,
    title: form.title.trim(),
    scheduled_date: form.scheduled_date || null,
    due_date: form.due_date || null,
    priority: form.priority || null,
    notes: form.notes,
    tag_ids: form.tag_ids,
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/state/taskUpdate.test.ts`
Expected: all 4 PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/tauri.ts src/state/taskUpdate.ts src/state/taskUpdate.test.ts
git commit -m "Add buildTaskUpdate helper and nullable TaskUpdate type (#1)"
```

---

## Task 3: Frontend — `TaskEditor` modal component

**Files:**
- Create: `src/components/TaskEditor.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/TaskEditor.tsx`:

```tsx
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api, Priority, Tag, Task } from "../lib/tauri";
import { buildTaskUpdate, EditorForm } from "../state/taskUpdate";

type Props = {
  task: Task;
  allTags: Map<string, Tag>;
  onClose: () => void;
};

const PRIORITIES: { value: "" | Priority; label: string }[] = [
  { value: "",     label: "None" },
  { value: "low",  label: "Low" },
  { value: "med",  label: "Medium" },
  { value: "high", label: "High" },
];

export function TaskEditor({ task, allTags, onClose }: Props) {
  const [form, setForm] = useState<EditorForm>({
    title: task.title,
    scheduled_date: task.scheduled_date ?? "",
    due_date: task.due_date ?? "",
    priority: task.priority ?? "",
    notes: task.notes ?? "",
    tag_ids: task.tag_ids,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const set = <K extends keyof EditorForm>(k: K, v: EditorForm[K]) =>
    setForm(f => ({ ...f, [k]: v }));

  const toggleTag = (id: string) =>
    setForm(f => ({
      ...f,
      tag_ids: f.tag_ids.includes(id) ? f.tag_ids.filter(t => t !== id) : [...f.tag_ids, id],
    }));

  const save = async () => {
    if (!form.title.trim()) { setError("Title can't be empty."); return; }
    setBusy(true);
    try {
      await api.updateTask(buildTaskUpdate(task.id, form));
      onClose();
    } catch (err) {
      setError(String(err));
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(`Delete "${task.title}"? This can't be undone.`)) return;
    setBusy(true);
    try {
      await api.deleteTask(task.id);
      onClose();
    } catch (err) {
      setError(String(err));
      setBusy(false);
    }
  };

  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="task-editor" role="dialog" aria-modal="true" aria-label="Edit task"
           onClick={e => e.stopPropagation()}>
        <label className="te-field">
          <span>Title</span>
          <input value={form.title} autoFocus
                 onChange={e => set("title", e.currentTarget.value)} />
        </label>

        <div className="te-row">
          <label className="te-field">
            <span>Scheduled</span>
            <input type="date" value={form.scheduled_date}
                   onChange={e => set("scheduled_date", e.currentTarget.value)} />
          </label>
          <label className="te-field">
            <span>Due</span>
            <input type="date" value={form.due_date}
                   onChange={e => set("due_date", e.currentTarget.value)} />
          </label>
          <label className="te-field">
            <span>Priority</span>
            <select value={form.priority}
                    onChange={e => set("priority", e.currentTarget.value as "" | Priority)}>
              {PRIORITIES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </label>
        </div>

        <div className="te-field">
          <span>Tags</span>
          <div className="te-tags">
            {[...allTags.values()].map(t => (
              <button type="button" key={t.id}
                      className={form.tag_ids.includes(t.id) ? "te-tag on" : "te-tag"}
                      style={{ borderColor: t.color, color: t.color }}
                      onClick={() => toggleTag(t.id)}>
                {t.name}
              </button>
            ))}
            {allTags.size === 0 && <span className="te-empty">No tags yet.</span>}
          </div>
        </div>

        <label className="te-field">
          <span>Notes</span>
          <textarea value={form.notes} rows={4}
                    onChange={e => set("notes", e.currentTarget.value)} />
        </label>

        {error && <p className="composer-error">{error}</p>}

        <div className="te-actions">
          <button type="button" className="te-delete" onClick={remove} disabled={busy}>Delete</button>
          <span className="te-spacer" />
          <button type="button" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="te-save" onClick={save}
                  disabled={busy || !form.title.trim()}>Save</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS (no type errors). `TaskEditor` is not yet imported anywhere, so this only verifies the component compiles.

- [ ] **Step 3: Commit**

```bash
git add src/components/TaskEditor.tsx
git commit -m "Add TaskEditor modal component (#1, #2)"
```

---

## Task 4: Frontend — rework `TaskRow` (open editor; move checkbox right; drop row delete)

**Files:**
- Modify: `src/components/TaskRow.tsx` (full rewrite of the component function and imports; keep `priColor`/`whenLabel`/`diffDays` helpers unchanged)

- [ ] **Step 1: Rewrite `TaskRow.tsx`**

Replace the entire file with (the three pure helpers are unchanged from the original):

```tsx
import { KeyboardEvent, useState } from "react";
import { Task, Tag } from "../lib/tauri";
import { api } from "../lib/tauri";
import { TaskEditor } from "./TaskEditor";

type Props = {
  task: Task;
  tags: Map<string, Tag>;
  todayIso: string;
};

function priColor(p: Task["priority"]): string {
  switch (p) {
    case "high": return "var(--c-pri-high)";
    case "med":  return "var(--c-pri-med)";
    case "low":  return "var(--c-pri-low)";
    default:     return "transparent";
  }
}

function whenLabel(t: Task, today: string): { text: string; late: boolean } {
  if (t.due_date) {
    if (t.due_date === today)       return { text: "due today", late: false };
    if (t.due_date < today && !t.done) return { text: `−${diffDays(t.due_date, today)}d`, late: true };
    return { text: `due ${t.due_date.slice(5)}`, late: false };
  }
  if (t.scheduled_date === today) return { text: "today", late: false };
  if (t.scheduled_date)           return { text: t.scheduled_date.slice(5), late: false };
  return { text: "", late: false };
}

function diffDays(a: string, b: string): number {
  const da = Date.parse(a), db = Date.parse(b);
  return Math.round((db - da) / 86400000);
}

export function TaskRow({ task, tags, todayIso }: Props) {
  const [editing, setEditing] = useState(false);
  const w = whenLabel(task, todayIso);
  const firstTag = task.tag_ids.length ? tags.get(task.tag_ids[0]) : undefined;

  const toggle = () => {
    api.setTaskDone(task.id, !task.done).catch(err => {
      console.error("setTaskDone failed:", err);
    });
  };

  const open = () => setEditing(true);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return; // ignore keys from the checkbox
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
  };

  return (
    <>
      <div className="task-row" data-done={task.done}
           role="button" tabIndex={0} aria-label={`Edit ${task.title}`}
           onClick={open} onKeyDown={onKey}>
        <span className="task-pri" style={{ background: priColor(task.priority) }} />
        <span className="task-title">{task.title}</span>
        {firstTag && (
          <span className="task-tag" style={{ background: firstTag.color + "22", color: firstTag.color }}>
            {firstTag.name}
          </span>
        )}
        {w.text && <span className={w.late ? "task-when late" : "task-when"}>{w.text}</span>}
        <input type="checkbox" checked={task.done} onChange={toggle}
               onClick={e => e.stopPropagation()}
               aria-label={`Toggle ${task.title}`} />
      </div>
      {editing && <TaskEditor task={task} allTags={tags} onClose={() => setEditing(false)} />}
    </>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Run the full JS test suite (no regressions)**

Run: `npm test`
Expected: all existing suites PASS (parse, indexes, quickAdd, taskUpdate).

- [ ] **Step 4: Commit**

```bash
git add src/components/TaskRow.tsx
git commit -m "Rework TaskRow: click to edit, checkbox on right, drop row delete (#1, #2, #3)"
```

---

## Task 5: CSS — modal styling, clickable row, remove dead delete rules

**Files:**
- Modify: `src/styles/global.css` (`.task-row` at 29-39; remove `.task-delete` at 46-47 and the mobile `.task-delete` block ~427; append modal styles)

- [ ] **Step 1: Make the row read as clickable**

In `src/styles/global.css`, add `cursor: pointer;` to the `.task-row` rule (29-39) and add a hover rule right after the closing brace of `.task-row` (after line 39):

```css
.task-row { cursor: pointer; }
.task-row:hover { border-color: var(--c-accent); }
```

(Add the `cursor` either inside the existing block or as the standalone rule shown above — both are fine; the standalone rule avoids reflowing the existing block.)

- [ ] **Step 2: Remove dead `.task-delete` rules**

Delete these now-unused rules:
- `src/styles/global.css:46-47` (the two `.task-delete` rules)
- the `.task-delete { … }` block inside the `@media (max-width: 720px)` section (around line 427)

- [ ] **Step 3: Append the modal styles**

Append to the end of `src/styles/global.css`:

```css
/* --- Task editor modal --- */
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: var(--space-5) var(--space-3);
  overflow-y: auto;
  z-index: 100;
}
.task-editor {
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--radius-lg);
  padding: var(--space-4);
  width: 100%;
  max-width: 460px;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
}
.te-field { display: flex; flex-direction: column; gap: var(--space-1); }
.te-field > span { font-size: 0.72rem; color: var(--c-text-muted); font-weight: 600; }
.te-row { display: flex; gap: var(--space-2); }
.te-row .te-field { flex: 1; min-width: 0; }
.te-tags { display: flex; flex-wrap: wrap; gap: var(--space-1); }
.te-tag {
  font-size: 0.75rem;
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--c-border);
  background: transparent;
  opacity: 0.55;
}
.te-tag.on { opacity: 1; font-weight: 600; }
.te-empty { font-size: 0.8rem; color: var(--c-text-muted); }
.te-actions { display: flex; align-items: center; gap: var(--space-2); margin-top: var(--space-2); }
.te-spacer { flex: 1; }
.te-delete { color: var(--c-danger); }
.te-save { font-weight: 600; }
```

- [ ] **Step 4: Type-check and build the frontend**

Run: `npm run build`
Expected: `tsc` passes and `vite build` completes with no errors.

- [ ] **Step 5: Commit**

```bash
git add src/styles/global.css
git commit -m "Style task editor modal and clickable row (#1, #2, #3)"
```

---

## Task 6: Verification

**Files:** none (verification only)

- [ ] **Step 1: Full type-check + tests + build**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: all green.

- [ ] **Step 2: Backend tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: all tests pass (including the three new `update_task_input_*`). Do not run `cargo fmt`.

- [ ] **Step 3: Manual smoke (desktop)**

Run: `npm run tauri dev` and verify on Windows:
- Clicking a task row (not the checkbox) opens the editor.
- Changing title / scheduled / due / priority / tags / notes and pressing **Save** persists (row reflects changes).
- Clearing a date (emptying the date input) and saving removes it from the row's when-label.
- The completion checkbox is on the **right** and toggles done **without** opening the editor.
- **Delete** in the editor prompts for confirmation, then removes the task.
- Esc / backdrop click / Cancel all close the editor without saving.

---

## Self-Review

- **Spec coverage:** #1 editor (Tasks 2-5), backend clear-field fix (Task 1), #2 delete-in-panel-with-confirm (Task 3 `remove`, Task 4 removes row `×`), #3 checkbox-on-right (Task 4 + Task 5 CSS). Manual + automated verification (Task 6). All spec sections covered.
- **Placeholder scan:** none — every code/step is concrete.
- **Type consistency:** `EditorForm` and `buildTaskUpdate` defined in Task 2 and used identically in Task 3; `TaskUpdate` defined in Task 2 and consumed by `api.updateTask`; `TaskEditor` prop names (`task`, `allTags`, `onClose`) match between Task 3 and Task 4.
