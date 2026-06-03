# Recurring Tasks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add recurring tasks (#9) by giving a `TemplateTask` an optional recurrence schedule that projects computed "ghost" rows into the date-based views; interacting with a ghost promotes it into a real task.

**Architecture:** Recurrence lives as one new optional field on `TemplateTask` (`recurrence`). Ghosts are computed in the frontend (`buildIndexes`), never stored. The suppression "link" is a tag the template carries plus the spawned instance's `due_date` (= occurrence date) — no new `Task`/`Tag` fields. Same-tag recurring templates act as same-day alternatives by design.

**Tech Stack:** Rust (Tauri 2, serde, chrono) for the model + commands; React 19 + TypeScript + Vite for the UI; vitest + `cargo test` for tests.

**Spec:** `docs/superpowers/specs/2026-06-03-recurring-tasks-design.md`

**Conventions to respect (from AGENTS.md / memory):**
- Rust uses an intentional aligned style — **do NOT run `cargo fmt`** on `src-tauri`.
- Run Rust checks with `cargo test --manifest-path src-tauri/Cargo.toml` and `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`.
- Frontend: `npx tsc --noEmit`, `npm test` (vitest), `npm run lint`.
- Model changes stay additive/backward-compatible (`#[serde(default)]` / optional TS keys).
- Weekday convention everywhere: **ISO 1=Mon .. 7=Sun**.

---

## File Structure

**Rust (`src-tauri/src/`):**
- `model.rs` — add `Recurrence` enum + `TemplateTask.recurrence`; bump `CURRENT_VERSION` 6→7. (Task 1)
- `commands.rs` — `recurrence` on `NewTemplateInput`/`UpdateTemplateInput`; `validate_recurrence`; wire into `add_template`/`update_template`; new `spawn_recurring_task` command. (Tasks 2, 3)
- `lib.rs` — register `spawn_recurring_task` in `generate_handler!`. (Task 3)

**Frontend (`src/`):**
- `lib/tauri.ts` — `Recurrence` type; add to `TemplateTask`/`NewTemplate`/`TemplateUpdate`; `api.spawnRecurringTask`. (Task 4)
- `lib/recurrence.ts` *(new)* — `isoWeekday`, `daysInMonth`, `occursOn`, `GhostTask` type. (Task 5)
- `lib/recurrence.test.ts` *(new)* — unit tests for the above. (Task 5)
- `state/indexes.ts` — `ghostsForDate(iso)` on `Indexes`. (Task 6)
- `state/indexes.test.ts` — ghost emission + suppression + alternatives tests. (Task 6)
- `state/taskUpdate.ts` — `EditorForm` recurrence fields + builders + `recurrenceFormError`. (Task 7)
- `components/TaskEditor.tsx` — template "Repeat" controls; require a tag; save wiring. (Task 7)
- `components/GhostRow.tsx` *(new)* — renders a ghost; promote-then-apply. (Task 8)
- `views/TodayView.tsx`, `views/UpcomingView.tsx`, `views/TagView.tsx` — render ghosts. (Task 9)
- `App.css` (or the existing stylesheet) — ghost-row + repeat-control styles. (Task 10)

---

## Task 1: Rust model — `Recurrence` enum + `TemplateTask.recurrence`

**Files:**
- Modify: `src-tauri/src/model.rs`
- Test: `src-tauri/src/model.rs` (`#[cfg(test)] mod tests`)

- [ ] **Step 1: Write the failing tests**

Add these tests inside `mod tests` in `src-tauri/src/model.rs` (after `v5_document_round_trips_template_tasks_without_is_template`):

```rust
    #[test]
    fn recurrence_round_trips_weekly_and_monthly() {
        let weekly: Recurrence =
            serde_json::from_str(r#"{"kind":"weekly","weekdays":[1,3,5]}"#).unwrap();
        assert_eq!(weekly, Recurrence::Weekly { weekdays: vec![1, 3, 5] });
        let monthly: Recurrence =
            serde_json::from_str(r#"{"kind":"monthly","day":15}"#).unwrap();
        assert_eq!(monthly, Recurrence::Monthly { day: 15 });

        // Serializes back to the same tagged shape.
        let json = serde_json::to_string(&Recurrence::Monthly { day: 1 }).unwrap();
        assert_eq!(json, r#"{"kind":"monthly","day":1}"#);
    }

    #[test]
    fn template_without_recurrence_loads_and_omits_the_key() {
        // A template written before #9 has no `recurrence` key: it must load as None
        // and re-serialize without the key (backward compatible).
        let t: TemplateTask = serde_json::from_str(
            r#"{"id":"k_1","title":"t","created_at":0}"#,
        ).unwrap();
        assert!(t.recurrence.is_none());
        let json = serde_json::to_string(&t).unwrap();
        assert!(!json.contains("recurrence"), "absent recurrence must not be written: {json}");

        // A present schedule round-trips.
        let mut sched = template("k_2");
        sched.recurrence = Some(Recurrence::Weekly { weekdays: vec![1, 2, 3, 4, 5] });
        let back: TemplateTask =
            serde_json::from_str(&serde_json::to_string(&sched).unwrap()).unwrap();
        assert_eq!(back.recurrence, Some(Recurrence::Weekly { weekdays: vec![1, 2, 3, 4, 5] }));
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml recurrence`
Expected: FAIL — `cannot find type 'Recurrence'` / field `recurrence` missing.

- [ ] **Step 3: Add the `Recurrence` enum**

In `src-tauri/src/model.rs`, add after the `Tag` struct (before `Task`):

```rust
/// A template's recurrence schedule (#9). The frontend projects "ghost" rows from
/// it into the date-based views; this type is just the stored rule. Weekday numbers
/// are ISO 1=Mon..7=Sun.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Recurrence {
    /// Fires on each listed weekday (ISO 1=Mon..7=Sun). The "Weekdays" preset is
    /// [1,2,3,4,5]. Validated non-empty with in-range days by the command layer.
    Weekly { weekdays: Vec<u8> },
    /// Fires on this day-of-month (1..=31); a day past the month's length clamps to
    /// the last day (handled where occurrences are computed).
    Monthly { day: u8 },
}
```

- [ ] **Step 4: Add the field to `TemplateTask` and `from_legacy`**

In the `TemplateTask` struct, add this field after `start_offset_days`:

```rust
    /// Optional recurrence schedule (#9). `None` = a manual-only template (the
    /// pre-#9 behavior). `#[serde(default)]` so older files load; `skip_serializing_if`
    /// keeps a manual template serializing byte-for-byte as before.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recurrence: Option<Recurrence>,
```

In `TemplateTask::from_legacy`, add `recurrence: None,` to the constructed struct (legacy `is_template` tasks never had a schedule).

- [ ] **Step 5: Update the `template()` test helper**

In `mod tests`, the `template(id: &str)` helper constructs a `TemplateTask`; add `recurrence: None,` to its struct literal so it still compiles.

- [ ] **Step 6: Bump the schema version**

Change `pub const CURRENT_VERSION: u32 = 6;` to `7` and extend the doc comment above it with a sentence in the existing style:

```rust
/// ... to 6 when tasks gained per-task time-tracking entries (`time_entries`, #81),
/// and to 7 when templates gained an optional recurrence schedule (`recurrence`,
/// #9). ...
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS (all model tests, including the two new ones).

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/model.rs
git commit -m "Add Recurrence schedule to TemplateTask model (#9)"
```

---

## Task 2: Rust commands — accept & validate `recurrence` on templates

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Test: `src-tauri/src/commands.rs` (`#[cfg(test)] mod tests`)

- [ ] **Step 1: Write the failing tests**

Add to `mod tests` in `src-tauri/src/commands.rs`:

```rust
    #[test]
    fn new_template_input_parses_recurrence() {
        let v: NewTemplateInput = serde_json::from_str(
            r#"{"title":"t","recurrence":{"kind":"weekly","weekdays":[1,5]}}"#,
        ).unwrap();
        assert_eq!(v.recurrence, Some(crate::model::Recurrence::Weekly { weekdays: vec![1, 5] }));
        let plain: NewTemplateInput = serde_json::from_str(r#"{"title":"t"}"#).unwrap();
        assert_eq!(plain.recurrence, None);
    }

    #[test]
    fn validate_recurrence_bounds() {
        use crate::model::Recurrence;
        assert!(validate_recurrence(None).is_ok());
        assert!(validate_recurrence(Some(&Recurrence::Weekly { weekdays: vec![1, 7] })).is_ok());
        assert!(validate_recurrence(Some(&Recurrence::Monthly { day: 31 })).is_ok());
        // Empty weekday set is meaningless.
        assert!(validate_recurrence(Some(&Recurrence::Weekly { weekdays: vec![] })).is_err());
        // Out-of-range weekday (0 or >7) and day-of-month (0 or >31).
        assert!(validate_recurrence(Some(&Recurrence::Weekly { weekdays: vec![0] })).is_err());
        assert!(validate_recurrence(Some(&Recurrence::Weekly { weekdays: vec![8] })).is_err());
        assert!(validate_recurrence(Some(&Recurrence::Monthly { day: 0 })).is_err());
        assert!(validate_recurrence(Some(&Recurrence::Monthly { day: 32 })).is_err());
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib recurrence`
Expected: FAIL — `validate_recurrence` not found; `NewTemplateInput` has no `recurrence`.

- [ ] **Step 3: Add the import and validator**

In `src-tauri/src/commands.rs`, add `Recurrence` to the model import on line 4:

```rust
use crate::model::{new_tag_id, new_task_id, new_time_entry_id, now_ms, Recurrence, Tag, Task, TemplateTask, TimeEntry};
```

Add the validator near `validate_offset_days`:

```rust
/// Reject a recurrence schedule that could never fire or carries an out-of-range
/// value, so a bad rule never persists (#9). Weekday numbers are ISO 1=Mon..7=Sun.
fn validate_recurrence(rec: Option<&Recurrence>) -> Result<()> {
    match rec {
        None => Ok(()),
        Some(Recurrence::Weekly { weekdays }) => {
            if weekdays.is_empty() {
                return Err(AppError::Invalid("weekly recurrence needs at least one weekday".into()));
            }
            if weekdays.iter().any(|d| !(1..=7).contains(d)) {
                return Err(AppError::Invalid("weekday must be 1..=7 (Mon..Sun)".into()));
            }
            Ok(())
        }
        Some(Recurrence::Monthly { day }) => {
            if !(1..=31).contains(day) {
                return Err(AppError::Invalid("monthly day must be 1..=31".into()));
            }
            Ok(())
        }
    }
}
```

- [ ] **Step 4: Add `recurrence` to the input structs**

In `NewTemplateInput`, add after `start_offset_days`:

```rust
    #[serde(default)] pub recurrence: Option<Recurrence>,
```

In `UpdateTemplateInput`, add after `start_offset_days` (double-option so the UI can clear it):

```rust
    #[serde(default, deserialize_with = "double_option")] pub recurrence: Option<Option<Recurrence>>,
```

- [ ] **Step 5: Wire into `add_template` and `update_template`**

In `add_template`, after the `validate_offset_days(...)` calls:

```rust
    validate_recurrence(input.recurrence.as_ref())?;
```

and add `recurrence: input.recurrence,` to the `TemplateTask { ... }` literal.

In `update_template`, after the existing offset handling inside the `write` closure:

```rust
        if let Some(v) = input.recurrence { validate_recurrence(v.as_ref())?; t.recurrence = v; }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/commands.rs
git commit -m "Accept and validate template recurrence in commands (#9)"
```

---

## Task 3: Rust command — `spawn_recurring_task`

**Files:**
- Modify: `src-tauri/src/commands.rs`, `src-tauri/src/lib.rs`
- Test: `src-tauri/tests/` is integration-only; unit-test the input parse in `commands.rs` `mod tests`.

- [ ] **Step 1: Write the failing test**

Add to `mod tests` in `commands.rs`:

```rust
    #[test]
    fn spawn_recurring_task_input_parses_camel_case_keys() {
        // The JS api sends { templateId, occurrenceDate }.
        let v: SpawnRecurringTaskInput = serde_json::from_str(
            r#"{"templateId":"k_1","occurrenceDate":"2026-06-08"}"#,
        ).unwrap();
        assert_eq!(v.template_id, "k_1");
        assert_eq!(v.occurrence_date, NaiveDate::from_ymd_opt(2026, 6, 8).unwrap());
    }
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib spawn_recurring`
Expected: FAIL — `SpawnRecurringTaskInput` not found.

- [ ] **Step 3: Add the input struct and command**

In `commands.rs`, in the Templates section, add:

```rust
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpawnRecurringTaskInput {
    pub template_id: String,
    pub occurrence_date: NaiveDate,
}

/// Promote a recurring template's ghost into a real task on its occurrence date
/// (#9). Copies the template's title/notes/tags and sets `due_date` to the
/// occurrence date — that tag + due_date pair is the only "link" back to the
/// recurrence, so the ghost self-suppresses on the next refresh. The task is
/// created active; the caller applies any follow-up action (complete / start timer).
#[tauri::command]
pub fn spawn_recurring_task(
    input: SpawnRecurringTaskInput,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Task> {
    let ts = now_ms();
    let saved = state.write(|d| {
        let tmpl = d.template_tasks.iter().find(|t| t.id == input.template_id)
            .ok_or_else(|| AppError::NotFound(format!("template {}", input.template_id)))?
            .clone();
        let task = Task {
            id: new_task_id(),
            title: tmpl.title,
            due_date: Some(input.occurrence_date),
            due_time: None,
            start_date: None,
            start_time: None,
            notes: tmpl.notes,
            tag_ids: retain_known_tags(tmpl.tag_ids, &d.tags),
            created_at: ts,
            completed_at: None,
            updated_at: ts,
            time_entries: Vec::new(),
        };
        d.tasks.push(task.clone());
        Ok(task)
    })?;
    emit_changed(&app);
    Ok(saved)
}
```

- [ ] **Step 4: Register the command**

In `src-tauri/src/lib.rs`, add to the `tauri::generate_handler![ ... ]` list after `commands::delete_template,`:

```rust
            commands::spawn_recurring_task,
```

- [ ] **Step 5: Run tests + clippy**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS.
Run: `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`
Expected: no warnings.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "Add spawn_recurring_task command (#9)"
```

---

## Task 4: Frontend types + api binding

**Files:**
- Modify: `src/lib/tauri.ts`
- Test: covered by `tsc --noEmit` (types) — no separate unit test for plain type defs.

- [ ] **Step 1: Add the `Recurrence` type**

In `src/lib/tauri.ts`, add above `TemplateTask`:

```ts
/** A template's recurrence schedule (#9). Weekday numbers are ISO 1=Mon..7=Sun. */
export type Recurrence =
  | { kind: "weekly"; weekdays: number[] } // fires on each listed ISO weekday
  | { kind: "monthly"; day: number };      // fires on this day-of-month, clamps to month end
```

- [ ] **Step 2: Add `recurrence` to the template types**

On `TemplateTask`, add:

```ts
  recurrence?: Recurrence; // #9; absent = manual-only template
```

On `NewTemplate`, add:

```ts
  recurrence?: Recurrence | null;
```

On `TemplateUpdate`, add (mirrors the offset double-option clearing semantics):

```ts
  recurrence?: Recurrence | null; // null clears the schedule; omitted leaves it
```

- [ ] **Step 3: Add the api binding**

In the `api` object, after `deleteTemplate`:

```ts
  spawnRecurringTask: (templateId: string, occurrenceDate: string) =>
                                   invoke<Task>("spawn_recurring_task", { input: { templateId, occurrenceDate } }),
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS (no errors).

- [ ] **Step 5: Commit**

```bash
git add src/lib/tauri.ts
git commit -m "Add Recurrence types and spawnRecurringTask binding (#9)"
```

---

## Task 5: Recurrence occurrence library

**Files:**
- Create: `src/lib/recurrence.ts`
- Test: `src/lib/recurrence.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/recurrence.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isoWeekday, daysInMonth, occursOn } from "./recurrence";

describe("isoWeekday", () => {
  it("maps ISO weekdays with Monday=1 and Sunday=7", () => {
    expect(isoWeekday("2026-06-08")).toBe(1); // Monday
    expect(isoWeekday("2026-06-13")).toBe(6); // Saturday
    expect(isoWeekday("2026-06-14")).toBe(7); // Sunday
  });
});

describe("daysInMonth", () => {
  it("returns the length of the month", () => {
    expect(daysInMonth("2026-02-15")).toBe(28); // non-leap Feb
    expect(daysInMonth("2024-02-15")).toBe(29); // leap Feb
    expect(daysInMonth("2026-04-10")).toBe(30);
    expect(daysInMonth("2026-01-10")).toBe(31);
  });
});

describe("occursOn", () => {
  it("weekly fires only on listed weekdays", () => {
    const mwf = { kind: "weekly", weekdays: [1, 3, 5] } as const;
    expect(occursOn(mwf, "2026-06-08")).toBe(true);  // Mon
    expect(occursOn(mwf, "2026-06-09")).toBe(false); // Tue
    expect(occursOn(mwf, "2026-06-10")).toBe(true);  // Wed
  });

  it("weekday preset fires Mon–Fri only", () => {
    const weekdays = { kind: "weekly", weekdays: [1, 2, 3, 4, 5] } as const;
    expect(occursOn(weekdays, "2026-06-12")).toBe(true);  // Fri
    expect(occursOn(weekdays, "2026-06-13")).toBe(false); // Sat
  });

  it("monthly fires on the day-of-month", () => {
    const r = { kind: "monthly", day: 15 } as const;
    expect(occursOn(r, "2026-06-15")).toBe(true);
    expect(occursOn(r, "2026-06-14")).toBe(false);
  });

  it("monthly clamps a too-large day to the last day of the month", () => {
    const r = { kind: "monthly", day: 31 } as const;
    expect(occursOn(r, "2026-02-28")).toBe(true);  // Feb has no 31st → clamps to 28
    expect(occursOn(r, "2026-02-27")).toBe(false);
    expect(occursOn(r, "2026-04-30")).toBe(true);  // Apr clamps to 30
    expect(occursOn(r, "2026-01-31")).toBe(true);  // Jan really has a 31st
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- recurrence`
Expected: FAIL — cannot find module `./recurrence`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/recurrence.ts`:

```ts
import { Recurrence } from "./tauri";

/** A computed, never-persisted recurrence occurrence shown as a row (#9). */
export type GhostTask = {
  id: string;             // `ghost_<templateId>_<iso>` — stable per occurrence
  title: string;
  tag_ids: string[];      // copied from the template; drives tag membership + priority
  templateId: string;
  occurrenceDate: string; // YYYY-MM-DD
};

/** Parse a YYYY-MM-DD string into a UTC Date (avoids local-tz/DST drift). */
function utcDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** ISO weekday for a date string: Monday=1 .. Sunday=7. */
export function isoWeekday(iso: string): number {
  const js = utcDate(iso).getUTCDay(); // 0=Sun..6=Sat
  return js === 0 ? 7 : js;
}

/** Number of days in the month of the given date string. */
export function daysInMonth(iso: string): number {
  const [y, m] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate(); // day 0 of next month = last of this
}

/** Whether a recurrence rule fires on the given date (YYYY-MM-DD). */
export function occursOn(rec: Recurrence, iso: string): boolean {
  if (rec.kind === "weekly") return rec.weekdays.includes(isoWeekday(iso));
  const dom = Number(iso.slice(8, 10));
  return dom === Math.min(rec.day, daysInMonth(iso));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- recurrence`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/recurrence.ts src/lib/recurrence.test.ts
git commit -m "Add recurrence occurrence library (#9)"
```

---

## Task 6: Ghost computation in `buildIndexes`

**Files:**
- Modify: `src/state/indexes.ts`
- Test: `src/state/indexes.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/state/indexes.test.ts` (follow the file's existing `buildIndexes` doc-construction pattern; minimal `Document` shape shown here):

```ts
import { describe, expect, it } from "vitest";
import { buildIndexes } from "./indexes";
import { Document } from "../lib/tauri";

function doc(over: Partial<Document>): Document {
  return {
    version: 7,
    settings: { theme: "auto", sort_order: "priority" },
    tags: [],
    tasks: [],
    template_tasks: [],
    ...over,
  } as Document;
}

const TAG = { id: "t_ex", name: "exercise", color: "#000", priority: 0 };

describe("ghostsForDate", () => {
  it("emits a ghost for a recurring template that fires that day", () => {
    const d = doc({
      tags: [TAG],
      template_tasks: [{
        id: "k_t", title: "Push-ups", notes: "", tag_ids: ["t_ex"], created_at: "",
        recurrence: { kind: "weekly", weekdays: [1] }, // Monday
      }],
    });
    const ix = buildIndexes(d);
    const mon = ix.ghostsForDate("2026-06-08"); // Monday
    expect(mon.map(g => g.title)).toEqual(["Push-ups"]);
    expect(mon[0].templateId).toBe("k_t");
    expect(mon[0].occurrenceDate).toBe("2026-06-08");
    expect(ix.ghostsForDate("2026-06-09")).toEqual([]); // Tuesday: no occurrence
  });

  it("does not emit a ghost for a tagless recurring template", () => {
    const d = doc({
      template_tasks: [{
        id: "k_t", title: "No tag", notes: "", tag_ids: [], created_at: "",
        recurrence: { kind: "weekly", weekdays: [1] },
      }],
    });
    expect(buildIndexes(d).ghostsForDate("2026-06-08")).toEqual([]);
  });

  it("suppresses the ghost when a same-tag task is due that day", () => {
    const d = doc({
      tags: [TAG],
      tasks: [{
        id: "k_done", title: "Push-ups", notes: "", tag_ids: ["t_ex"],
        created_at: "", due_date: "2026-06-08",
      }],
      template_tasks: [{
        id: "k_t", title: "Push-ups", notes: "", tag_ids: ["t_ex"], created_at: "",
        recurrence: { kind: "weekly", weekdays: [1] },
      }],
    });
    expect(buildIndexes(d).ghostsForDate("2026-06-08")).toEqual([]);
  });

  it("same-tag templates are alternatives: one due task clears both ghosts", () => {
    const d = doc({
      tags: [TAG],
      tasks: [{
        id: "k_done", title: "Push-ups", notes: "", tag_ids: ["t_ex"],
        created_at: "", due_date: "2026-06-08",
      }],
      template_tasks: [
        { id: "k_p", title: "Push-ups", notes: "", tag_ids: ["t_ex"], created_at: "",
          recurrence: { kind: "weekly", weekdays: [1] } },
        { id: "k_s", title: "Sit-ups", notes: "", tag_ids: ["t_ex"], created_at: "",
          recurrence: { kind: "weekly", weekdays: [1] } },
      ],
    });
    // A push-ups task due that day shares the `exercise` tag, so BOTH ghosts clear.
    expect(buildIndexes(d).ghostsForDate("2026-06-08")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- indexes`
Expected: FAIL — `ghostsForDate` is not a function.

- [ ] **Step 3: Implement `ghostsForDate`**

In `src/state/indexes.ts`:

Add the import at the top:

```ts
import { GhostTask, occursOn } from "../lib/recurrence";
```

Add `ghostsForDate` to the `Indexes` type:

```ts
  /** Recurring-template ghost rows for a given day (YYYY-MM-DD); computed, never stored. */
  ghostsForDate: (iso: string) => GhostTask[];
```

Inside `buildIndexes`, before the final `return`, build the suppression index and the function:

```ts
  // Recurring templates project ghost rows into the date-based views (#9). A ghost
  // is suppressed when a real task already covers that occurrence: any task due on
  // that date that shares a tag with the template. (Same-tag recurring templates
  // therefore act as same-day alternatives — acting on one clears the others.)
  const recurringTemplates = doc.template_tasks.filter(t => t.recurrence && t.tag_ids.length > 0);
  // dueDate -> set of tag ids carried by tasks due that day (open or completed).
  const dueTagsByDate = new Map<string, Set<string>>();
  for (const t of doc.tasks) {
    if (!t.due_date) continue;
    let set = dueTagsByDate.get(t.due_date);
    if (!set) { set = new Set(); dueTagsByDate.set(t.due_date, set); }
    for (const id of t.tag_ids) set.add(id);
  }
  const ghostsForDate = (iso: string): GhostTask[] => {
    const covered = dueTagsByDate.get(iso);
    const out: GhostTask[] = [];
    for (const tmpl of recurringTemplates) {
      if (!occursOn(tmpl.recurrence!, iso)) continue;
      if (covered && tmpl.tag_ids.some(id => covered.has(id))) continue; // already done that day
      out.push({
        id: `ghost_${tmpl.id}_${iso}`,
        title: tmpl.title,
        tag_ids: tmpl.tag_ids,
        templateId: tmpl.id,
        occurrenceDate: iso,
      });
    }
    return out;
  };
```

Add `ghostsForDate` to the returned object:

```ts
  return { byTag, today, todayIso, inbox, archived, templates, tagsById, tagsByName, tasks: active, ghostsForDate };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- indexes`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/state/indexes.ts src/state/indexes.test.ts
git commit -m "Compute recurring-template ghosts in buildIndexes (#9)"
```

---

## Task 7: Template editor — "Repeat" controls

**Files:**
- Modify: `src/state/taskUpdate.ts`, `src/components/TaskEditor.tsx`
- Test: `src/state/taskUpdate.test.ts` (create if absent, else append)

This task adds the recurrence UI to the template editor and the form↔payload mapping. Recurrence requires ≥1 tag (the editor enforces it).

- [ ] **Step 1: Write the failing tests for the form helpers**

Append to `src/state/taskUpdate.test.ts` (create the file with this content if it does not exist):

```ts
import { describe, expect, it } from "vitest";
import { recurrenceFromForm, recurrenceFormError, EditorForm } from "./taskUpdate";

const base: EditorForm = {
  title: "t", start_date: "", start_time: "", due_date: "", due_time: "",
  notes: "", tag_ids: ["t_ex"], new_tag_names: [], is_template: true,
  due_offset_days: "", start_offset_days: "",
  repeat: "none", repeat_weekdays: [], repeat_day: "",
};

describe("recurrenceFromForm", () => {
  it("returns null when repeat is none", () => {
    expect(recurrenceFromForm(base)).toBeNull();
  });
  it("builds a weekly rule from selected weekdays", () => {
    expect(recurrenceFromForm({ ...base, repeat: "weekly", repeat_weekdays: [1, 5] }))
      .toEqual({ kind: "weekly", weekdays: [1, 5] });
  });
  it("builds a monthly rule from the day input", () => {
    expect(recurrenceFromForm({ ...base, repeat: "monthly", repeat_day: "15" }))
      .toEqual({ kind: "monthly", day: 15 });
  });
});

describe("recurrenceFormError", () => {
  it("requires a tag when a schedule is set", () => {
    expect(recurrenceFormError({ ...base, repeat: "weekly", repeat_weekdays: [1], tag_ids: [], new_tag_names: [] }))
      .toMatch(/tag/i);
  });
  it("requires at least one weekday for weekly", () => {
    expect(recurrenceFormError({ ...base, repeat: "weekly", repeat_weekdays: [] })).toMatch(/day/i);
  });
  it("requires a valid 1–31 day for monthly", () => {
    expect(recurrenceFormError({ ...base, repeat: "monthly", repeat_day: "0" })).toMatch(/1.*31/);
    expect(recurrenceFormError({ ...base, repeat: "monthly", repeat_day: "32" })).toMatch(/1.*31/);
  });
  it("passes for a valid weekly rule with a tag", () => {
    expect(recurrenceFormError({ ...base, repeat: "weekly", repeat_weekdays: [1] })).toBeNull();
  });
  it("is null when repeat is none", () => {
    expect(recurrenceFormError(base)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- taskUpdate`
Expected: FAIL — `recurrenceFromForm` / `recurrenceFormError` / form fields missing.

- [ ] **Step 3: Extend `EditorForm` and add the helpers**

In `src/state/taskUpdate.ts`:

Add the import:

```ts
import { Recurrence, TaskUpdate, TemplateUpdate } from "../lib/tauri";
```

Add fields to `EditorForm` (after `start_offset_days`):

```ts
  // Recurrence UI state (#9), template mode only. `repeat` picks the mode; the
  // other two hold that mode's inputs. ISO weekdays 1=Mon..7=Sun.
  repeat: "none" | "weekly" | "monthly";
  repeat_weekdays: number[];
  repeat_day: string; // "" or "1".."31"
```

Add the helpers at the end of the file:

```ts
/** Build a Recurrence from the editor form, or null when repeat is off/invalid. */
export function recurrenceFromForm(form: EditorForm): Recurrence | null {
  if (form.repeat === "weekly") {
    return form.repeat_weekdays.length ? { kind: "weekly", weekdays: [...form.repeat_weekdays].sort((a, b) => a - b) } : null;
  }
  if (form.repeat === "monthly") {
    const day = parseInt(form.repeat_day.trim(), 10);
    return Number.isInteger(day) && day >= 1 && day <= 31 ? { kind: "monthly", day } : null;
  }
  return null;
}

/** Validation message for the recurrence inputs, or null when valid (#9). */
export function recurrenceFormError(form: EditorForm): string | null {
  if (form.repeat === "none") return null;
  const hasTag = form.tag_ids.length > 0 || (form.new_tag_names?.length ?? 0) > 0;
  if (!hasTag) return "Add a tag so this template can recur.";
  if (form.repeat === "weekly" && form.repeat_weekdays.length === 0) {
    return "Pick at least one weekday to repeat on.";
  }
  if (form.repeat === "monthly") {
    const day = parseInt(form.repeat_day.trim(), 10);
    if (!Number.isInteger(day) || day < 1 || day > 31) return "Day of month must be 1–31.";
  }
  return null;
}
```

Add `recurrence` to `buildTemplateUpdate`'s returned object:

```ts
    recurrence: recurrenceFromForm(form),
```

Add the recurrence fields to `isEditorDirty` so changing them marks the form dirty:

```ts
    || form.repeat !== initial.repeat
    || form.repeat_day !== initial.repeat_day
    || form.repeat_weekdays.join(",") !== initial.repeat_weekdays.join(",")
```

- [ ] **Step 4: Run the helper tests to verify they pass**

Run: `npm test -- taskUpdate`
Expected: PASS.

- [ ] **Step 5: Seed the form from the template + render the controls**

In `src/components/TaskEditor.tsx`:

Add to the `initialRef` object literal (so editing a template pre-fills its schedule):

```ts
    repeat: tmplEntity?.recurrence?.kind ?? "none",
    repeat_weekdays: tmplEntity?.recurrence?.kind === "weekly" ? tmplEntity.recurrence.weekdays : [],
    repeat_day: tmplEntity?.recurrence?.kind === "monthly" ? String(tmplEntity.recurrence.day) : "",
```

Add the import:

```ts
import { buildTaskUpdate, buildTemplateUpdate, dueBeforeStart, EditorForm, isEditorDirty, offsetFormError, recurrenceFormError, recurrenceFromForm } from "../state/taskUpdate";
```

Compute the error alongside `offsetError`:

```ts
  const recurError = isTemplate ? recurrenceFormError(form) : null;
```

Render the controls inside the template branch, after the offset row's `{offsetError && ...}` line. Weekday labels are Mon..Sun = ISO 1..7:

```tsx
            <div className="te-field">
              <span>Repeat</span>
              <select value={form.repeat}
                      onChange={e => set("repeat", e.currentTarget.value as EditorForm["repeat"])}>
                <option value="none">Doesn’t repeat</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>
            {form.repeat === "weekly" && (
              <div className="te-weekdays" role="group" aria-label="Repeat on weekdays">
                {[["Mon",1],["Tue",2],["Wed",3],["Thu",4],["Fri",5],["Sat",6],["Sun",7]].map(([label, n]) => {
                  const day = n as number;
                  const on = form.repeat_weekdays.includes(day);
                  return (
                    <button type="button" key={day} aria-pressed={on}
                            className={on ? "te-weekday on" : "te-weekday"}
                            onClick={() => set("repeat_weekdays",
                              on ? form.repeat_weekdays.filter(d => d !== day)
                                 : [...form.repeat_weekdays, day])}>
                      {label as string}
                    </button>
                  );
                })}
                <button type="button" className="te-weekday-preset"
                        onClick={() => set("repeat_weekdays", [1, 2, 3, 4, 5])}>
                  Weekdays
                </button>
              </div>
            )}
            {form.repeat === "monthly" && (
              <label className="te-field">
                <span>Day of month (clamps to the month’s last day)</span>
                <input type="number" min={1} max={31} inputMode="numeric" placeholder="e.g. 15"
                       value={form.repeat_day}
                       onChange={e => set("repeat_day", e.currentTarget.value)} />
              </label>
            )}
            {recurError && <p className="te-warn" role="alert">{recurError}</p>}
```

- [ ] **Step 6: Block save on a recurrence error**

In `save()`, after the `offsetError` guard, add:

```ts
      if (recurError) { setError(recurError); return; }
```

In the `addTemplate` call inside `save()`, add `recurrence: recurrenceFromForm(form),` to the payload object. (The update path already carries it via `buildTemplateUpdate`.)

Add `|| !!recurError` to the Save button's `disabled` expression:

```tsx
                  disabled={busy || !form.title.trim() || !!dateError || !!offsetError || !!recurError}>
```

- [ ] **Step 7: Type-check, lint, test**

Run: `npx tsc --noEmit` → PASS
Run: `npm run lint` → PASS
Run: `npm test -- taskUpdate` → PASS

- [ ] **Step 8: Commit**

```bash
git add src/state/taskUpdate.ts src/state/taskUpdate.test.ts src/components/TaskEditor.tsx
git commit -m "Add Repeat controls to the template editor (#9)"
```

---

## Task 8: GhostRow component (promote-then-apply)

**Files:**
- Create: `src/components/GhostRow.tsx`
- Test: none (thin UI wiring; behavior covered by manual verification + the indexes tests for suppression). The component is small and mostly markup.

- [ ] **Step 1: Write the component**

Create `src/components/GhostRow.tsx`:

```tsx
import { useState } from "react";
import { api, Tag, Task } from "../lib/tauri";
import { GhostTask } from "../lib/recurrence";
import { errorMessage } from "../lib/errors";
import { readableTextColor } from "../lib/tags";
import { TaskEditor } from "./TaskEditor";

type Props = {
  ghost: GhostTask;
  tags: Map<string, Tag>;
};

/**
 * A computed recurring-template occurrence (#9). It is not a real task until the
 * user interacts: any action first promotes it via spawn_recurring_task, then
 * applies the action to the returned task. The de-emphasised styling + 🔁 marker
 * distinguish it from real rows.
 */
export function GhostRow({ ghost, tags }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Task | null>(null);

  const ghostTags = ghost.tag_ids
    .map(id => tags.get(id))
    .filter((t): t is Tag => t !== undefined)
    .sort((a, b) => b.priority - a.priority);

  const promote = async (): Promise<Task> =>
    api.spawnRecurringTask(ghost.templateId, ghost.occurrenceDate);

  const run = (after: (t: Task) => Promise<unknown> | void) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    promote()
      .then(async t => { await after(t); })
      .catch(err => { setError(errorMessage(err)); setBusy(false); });
    // On success the store refreshes (store-changed) and this ghost disappears, so
    // there's no need to clear `busy` in the happy path — the row unmounts.
  };

  const complete = () => run(t => api.setTaskDone(t.id, true));
  const open = () => run(t => setEditing(t));
  const startTimer = () => run(t => api.startTimer(t.id));

  return (
    <>
      <div className="task-row ghost-row" data-ghost="true">
        <button type="button" className="task-main" onClick={open} disabled={busy}
                aria-label={`Start ${ghost.title} (recurring)`}>
          <span className="ghost-mark" aria-hidden>🔁</span>
          <span className="task-title">{ghost.title}</span>
          {ghostTags.map(t => (
            <span key={t.id} className="task-tag" style={{ background: t.color, color: readableTextColor(t.color) }}>
              {t.name}
            </span>
          ))}
        </button>
        <button type="button" className="task-timer" onClick={startTimer} disabled={busy}
                aria-label={`Start timer for ${ghost.title}`} title="Start timer">
          <span className="task-timer-icon" aria-hidden>▶</span>
        </button>
        <input type="checkbox" checked={false} onChange={complete} disabled={busy}
               aria-label={`Complete ${ghost.title}`} />
      </div>
      {error && <p className="composer-error" role="alert">Couldn’t add: {error}</p>}
      {editing && (
        <TaskEditor task={editing} allTags={tags} onClose={() => setEditing(null)} />
      )}
    </>
  );
}
```

- [ ] **Step 2: Type-check & lint**

Run: `npx tsc --noEmit` → PASS
Run: `npm run lint` → PASS

- [ ] **Step 3: Commit**

```bash
git add src/components/GhostRow.tsx
git commit -m "Add GhostRow component for recurring-task occurrences (#9)"
```

---

## Task 9: Render ghosts in Today, Upcoming, and Tag views

**Files:**
- Modify: `src/views/TodayView.tsx`, `src/views/UpcomingView.tsx`, `src/views/TagView.tsx`

- [ ] **Step 1: Today view**

In `src/views/TodayView.tsx`, import `GhostRow` and render today's ghosts above the task list:

```tsx
import { GhostRow } from "../components/GhostRow";
```

Inside the component, after computing `tasks`:

```tsx
  const ghosts = indexes.ghostsForDate(today);
```

Render the ghost rows between the `<Composer ... />` and the `<TaskList ... />`:

```tsx
      {ghosts.map(g => <GhostRow key={g.id} ghost={g} tags={indexes.tagsById} />)}
```

- [ ] **Step 2: Tag view**

In `src/views/TagView.tsx`, import `GhostRow` and render today's ghosts for this tag only (today-only per spec):

```tsx
import { GhostRow } from "../components/GhostRow";
```

After `const tasks = withHeld(active, held);`:

```tsx
  const ghosts = indexes.ghostsForDate(indexes.todayIso).filter(g => g.tag_ids.includes(id));
```

Render between `<Composer ... />` and `<TaskList ... />`:

```tsx
      {ghosts.map(g => <GhostRow key={g.id} ghost={g} tags={indexes.tagsById} />)}
```

- [ ] **Step 3: Upcoming view**

In `src/views/UpcomingView.tsx`, import `GhostRow`, extend each day group with that day's ghosts, and render them at the top of each group.

Add the import:

```tsx
import { GhostRow } from "../components/GhostRow";
import { GhostTask } from "../lib/recurrence";
```

Change `Group` and `buildGroups` to carry ghosts, and include a group when it has ghosts even if it has no real tasks:

```tsx
type Group = { date: string; label: string; tasks: Task[]; ghosts: GhostTask[] };

function buildGroups(indexes: Indexes, todayStr: string, horizon: number, held: Task[]): Group[] {
  const today = dayjs(todayStr);
  const onDay = (t: Task, iso: string) => t.start_date === iso || t.due_date === iso;
  const result: Group[] = [];
  for (let i = 1; i <= horizon; i++) {
    const day = today.add(i, "day");
    const iso = day.format("YYYY-MM-DD");
    const tasks = indexes.tasks
      .filter(t => onDay(t, iso))
      .sort((a, b) => effectivePriority(b, indexes.tagsById) - effectivePriority(a, indexes.tagsById));
    const heldForDay = held.filter(t => onDay(t, iso) && !tasks.some(a => a.id === t.id));
    const all = [...tasks, ...heldForDay];
    const ghosts = indexes.ghostsForDate(iso);
    if (all.length > 0 || ghosts.length > 0) {
      result.push({ date: iso, label: labelFor(day, today), tasks: all, ghosts });
    }
  }
  return result;
}
```

Update `totalCount` to include ghosts and render them at the top of each group:

```tsx
  const totalCount =
    new Set(groups.flatMap(g => g.tasks.map(t => t.id))).size +
    groups.reduce((n, g) => n + g.ghosts.length, 0);
```

```tsx
        <div key={g.date} className="upcoming-group">
          <h3 className="upcoming-day">{g.label}</h3>
          {g.ghosts.map(gh => <GhostRow key={gh.id} ghost={gh} tags={indexes.tagsById} />)}
          <TaskList tasks={g.tasks} tags={indexes.tagsById} todayIso={today}
                    onCompleted={onCompleted} onReopened={onReopened} />
        </div>
```

Note: `TaskList` renders an empty-state paragraph when `tasks` is empty; for a ghost-only day that reads oddly. Pass `emptyText=""` to suppress it when there are ghosts, or guard the `<TaskList>` with `{g.tasks.length > 0 && ...}`. Use the guard:

```tsx
          {g.tasks.length > 0 && (
            <TaskList tasks={g.tasks} tags={indexes.tagsById} todayIso={today}
                      onCompleted={onCompleted} onReopened={onReopened} />
          )}
```

- [ ] **Step 4: Type-check, lint, full test run**

Run: `npx tsc --noEmit` → PASS
Run: `npm run lint` → PASS
Run: `npm test` → PASS

- [ ] **Step 5: Commit**

```bash
git add src/views/TodayView.tsx src/views/UpcomingView.tsx src/views/TagView.tsx
git commit -m "Render recurring ghosts in Today, Upcoming, and Tag views (#9)"
```

---

## Task 10: Styles for the ghost row + repeat controls

**Files:**
- Modify: the global stylesheet (find with `grep -rl "task-row" src/**/*.css` — likely `src/App.css` or `src/styles.css`).

- [ ] **Step 1: Add styles**

Append to the stylesheet (match the existing CSS-variable / color conventions used by `.task-row`):

```css
/* Recurring-task ghost rows (#9): de-emphasised so they read as "not yet real". */
.ghost-row { opacity: 0.62; }
.ghost-row .task-title { font-style: italic; }
.ghost-row .ghost-mark { margin-right: 0.4em; opacity: 0.8; }

/* Template editor weekday toggles. */
.te-weekdays { display: flex; flex-wrap: wrap; gap: 0.25rem; }
.te-weekday, .te-weekday-preset {
  padding: 0.2rem 0.5rem; border: 1px solid var(--border, #ccc);
  border-radius: 0.375rem; background: transparent; cursor: pointer;
}
.te-weekday.on { background: var(--accent, #10b981); color: #fff; border-color: transparent; }
```

- [ ] **Step 2: Verify visually in the running app (deferred to the verification phase).**

- [ ] **Step 3: Commit**

```bash
git add src/App.css
git commit -m "Style recurring ghost rows and repeat controls (#9)"
```

---

## Final verification (before PR)

- [ ] **Rust:** `cargo test --manifest-path src-tauri/Cargo.toml` → all pass.
- [ ] **Rust lint:** `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings` → clean.
- [ ] **Android cfg compiles** (CI doesn't build Android — verify locally per memory): `cargo clippy --manifest-path src-tauri/Cargo.toml --target aarch64-linux-android -- -D warnings` → clean. (The change is plain cross-platform model/command code, so this should pass without `#[cfg]`.)
- [ ] **Frontend:** `npx tsc --noEmit` → clean; `npm test` → all pass; `npm run lint` → clean.
- [ ] **Manual smoke (desktop):** create a tag; create a template, set it to repeat weekly on today's weekday with that tag; confirm a 🔁 ghost appears in Today and on the matching day(s) in Upcoming; check it off → it becomes a completed task and the ghost disappears; reload → ghost stays gone for today; confirm a tagless template shows no ghost.

---

## Self-Review (completed during planning)

**Spec coverage:**
- Recurrence enum + patterns (weekly/monthly, clamp) → Tasks 1, 5.
- Tag-as-link suppression + alternatives → Task 6.
- No new Task/Tag fields → confirmed (Tasks 1, 3 use only `due_date` + `tag_ids`).
- Promote-then-apply (complete/open/timer), `due_date` = occurrence → Tasks 3, 8.
- Surfaces: Today (today), Upcoming (horizon), Tag (today only) → Task 9.
- Recurrence requires a tag → Tasks 6 (compute) + 7 (UI enforcement).
- Version 6→7, backward compatibility → Task 1.
- Tests (Rust serde/validation/spawn; TS occurrence/ghosts/alternatives) → Tasks 1,2,3,5,6,7.

**Type consistency:** `Recurrence` (`{kind:"weekly",weekdays}` / `{kind:"monthly",day}`) is identical across `tauri.ts`, `recurrence.ts`, and the Rust tagged enum (`snake_case`). `GhostTask` fields (`id,title,tag_ids,templateId,occurrenceDate`) are consistent across `recurrence.ts`, `indexes.ts`, `GhostRow.tsx`, and the views. `spawnRecurringTask(templateId, occurrenceDate)` ↔ `SpawnRecurringTaskInput { template_id, occurrence_date }` via camelCase rename.

**Placeholder scan:** none — every code step contains complete code.
