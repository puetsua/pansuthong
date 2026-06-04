# Recurrence: start-date promotion + Daily/Yearly patterns — design

**Status:** approved · **Date:** 2026-06-04 · **Builds on:** [2026-06-03-recurring-tasks-design.md](./2026-06-03-recurring-tasks-design.md)

> **Addendum (multi-day, 2026-06-04):** Monthly and Yearly now accept **multiple
> days**. Monthly stores `days: number[]` (e.g. the 1st and 15th); Yearly stores
> `dates: {month, day}[]` — a list of independent month+day pairs (e.g. Jan 1, Apr
> 15, Dec 25). This supersedes the single-day `monthly {day}` / `yearly {month,day}`
> shapes described below. `occursOn` fires if **any** listed day/date matches (monthly
> still clamps each day to month-end; yearly stays exact / skip-Feb-29). Loading is
> backward-compatible via `RecurrenceCompat` (folds legacy `{day}` → `{days:[day]}`
> and `{month,day}` → `{dates:[{month,day}]}`), and `CURRENT_VERSION` bumps 7 → 8.
> The editor takes a comma-separated days input (Monthly) and an add/remove list of
> month+day rows (Yearly).

## Summary

Two refinements to the recurring-tasks feature (#9):

1. **Promote on start date, not due date.** A recurring occurrence is something you
   *begin* on its date, not something *due* then. Promoting a ghost now stamps
   `start_date = occurrence_date` (was `due_date`), and ghost suppression keys off
   `start_date`.
2. **Two new recurrence patterns:** **Daily** (every day) and **Yearly**
   (a fixed month + day-of-month, e.g. "every Mar 15").

All changes are additive and backward-compatible (`#[serde(default)]`, internally
tagged enum, optional TS keys). No `CURRENT_VERSION` bump: the existing optional
`TemplateTask.recurrence` field is unchanged in shape — Daily/Yearly are just new
values of the already-versioned enum, and older files still load.

## 1. Start-date promotion

The recurrence "link" is unchanged in concept (the template's `recurrence_tag_id`
tag, carried by the spawned instance), but the **date field** it rides on moves
from `due_date` to `start_date`.

- **`spawn_recurring_task`** (`src-tauri/src/commands.rs`): set
  `start_date = Some(occurrence_date)`, `start_time = None`, and leave `due_date`/
  `due_time` `None`.
- **Suppression** (`buildIndexes`, `src/state/indexes.ts`): the
  `dateIso -> Set<tagId>` map ("tags carried by a task on that date") is built from
  `task.start_date` instead of `task.due_date`. A ghost for date `D` is suppressed
  when a task with `start_date == D` carries the template's `recurrence_tag_id`.
- **Ghost open-editor draft** (`src/components/GhostRow.tsx`): the creating-draft
  pre-fills `start_date = occurrenceDate` (was `due_date`).
- **Views:** Today (`inToday`) and Upcoming (`onDay`) already surface a task when
  `start_date` *or* `due_date` matches the day, so promoted instances still appear
  on their occurrence day with no view changes.

**Accepted consequence:** suppression now requires a task *started* on `D` with the
recurrence tag. A manual task merely *due* (not started) on `D` with that tag no
longer hides the ghost. This is the intended effect of the switch.

**No migration:** already-spawned instances keep their existing `due_date`; only
new promotions use `start_date`.

## 2. Daily and Yearly patterns

### Data model (`src-tauri/src/model.rs`)

```rust
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Recurrence {
    Weekly  { weekdays: Vec<u8> },
    Monthly { day: u8 },
    Daily,                          // new: fires every day
    Yearly  { month: u8, day: u8 }, // new: fixed month (1..=12) + day-of-month
}
```

TS mirror (`src/lib/tauri.ts`):

```ts
export type Recurrence =
  | { kind: "weekly"; weekdays: number[] }
  | { kind: "monthly"; day: number }
  | { kind: "daily" }
  | { kind: "yearly"; month: number; day: number };
```

### Occurrence test (`src/lib/recurrence.ts`)

- **daily:** always `true`.
- **yearly:** **exact match, no clamp** —
  `monthOf(iso) === rec.month && domOf(iso) === rec.day`. A Feb-29 rule therefore
  matches only in leap years and is simply absent in non-leap years (**skip**
  semantics, chosen over Monthly's clamp).

### Validation (`validate_recurrence`, `src-tauri/src/commands.rs`)

- **daily:** always valid.
- **yearly:** `month` in `1..=12`; `day` in `1..=max_day(month)` where
  `max_day` is 31/30/29 (February = 29, to permit the leap-only occurrence). This
  rejects a day that could *never* occur in the chosen month (e.g. Apr 31, Feb 30),
  so a yearly rule is never silently inert.
- weekly/monthly validation unchanged.

### UI (`src/components/TaskEditor.tsx`, `src/state/taskUpdate.ts`)

- The **Repeat** dropdown gains **Every day** and **Every year** alongside
  None / Weekly / Monthly.
- **Yearly** reveals a **month** selector (Jan–Dec) and a **day** input; the day
  input's `max` tracks the selected month (Feb = 29). Defaults: current/first
  sensible month + day 1.
- **Daily** reveals no extra controls.
- `EditorForm` gains `repeat_month` (and reuses `repeat_day` for the yearly day);
  `recurrenceFromForm` builds the `daily`/`yearly` variants; `recurrenceFormError`
  validates the yearly month/day shape (then the existing tag-required checks);
  `isEditorDirty` compares the new fields.
- The recurrence-tag requirement (a schedule needs a designated tag) is unchanged
  and applies to all four patterns.

## Testing (TDD)

**Rust (`src-tauri`):**
- `Recurrence` serde round-trips for `daily` (unit variant) and `yearly`
  (`{kind:"yearly",month,day}`).
- `validate_recurrence`: daily ok; yearly bounds (month 1..=12; day within month,
  incl. Feb 29 allowed, Feb 30 / Apr 31 rejected).
- `spawn_recurring_task` sets `start_date = occurrence_date` (and not `due_date`).

**TypeScript (vitest):**
- `recurrence.test.ts`: `occursOn` daily (any date true); yearly exact match;
  Feb 29 fires in a leap year, absent in a non-leap year.
- `indexes.test.ts`: suppression now keyed on `start_date` — a task with
  `start_date == D` carrying the recurrence tag suppresses the ghost; a task merely
  `due_date == D` does **not**.

## Out of scope

Every-N-days / interval multipliers; changing already-spawned instances; weekly/
monthly behavior; the recurrence-tag link mechanism.
