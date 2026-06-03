# Recurring tasks (#9) — design

**Status:** approved (brainstorm) · **Date:** 2026-06-03

## Summary

Recurring tasks ("every Monday", "every weekday", "every month on the 15th"),
built by extending the existing **TemplateTask** system (#71) with an optional
**recurrence schedule**. A scheduled template projects a *ghost row* into the
date-based views on its occurrence dates. Ghosts are **computed, never stored** —
the user *promotes* a ghost into a real task by interacting with it.

This avoids a standalone rule engine, instance-spawning bookkeeping, and
ambiguous completion semantics: nothing is persisted speculatively, so there is
no catch-up/flooding problem and no "did I complete last week's?" state to track.

## Decisions (from brainstorming)

- **Model:** recurring *templates* — extend `TemplateTask`, reuse the Templates
  view and spawn path. A template with no schedule keeps today's manual-spawn
  behavior, unchanged.
- **Patterns (v1 scope, no wider):**
  - **Weekly on weekdays** — a set of weekdays (e.g. every Mon; Mon/Wed/Fri; the
    "Weekdays" preset = Mon–Fri).
  - **Monthly on day-of-month** — a single day 1–31; days past the month's length
    **clamp to the last day** (e.g. 31 → Feb 28/29).
  - Explicitly **out of scope:** every-N-days, and interval multipliers
    ("every 2 weeks", "every 3 months").
- **Surfacing — ghosts are computed, never stored:**
  - **Today view:** today's occurrence.
  - **Upcoming view:** every occurrence in the horizon `[today+1 … today+upcoming_days]`,
    merged into each day's group. The only multi-day surface.
  - **Tag views:** **today's** occurrence only (tag views are not date-scoped, so
    a multi-day projection has no natural home there).
- **Vanish if not acted:** a ghost is purely a function of the rule + date. A
  missed past occurrence appears in neither Today nor Upcoming. Nothing piles up,
  no overdue ghosts.
- **Interaction = promote, then apply:** any interaction (check / open / start
  timer) first promotes the ghost into a real task, then applies the action.
- **Promoted task date:** `due_date = occurrence date`. Once promoted it is an
  ordinary task; if left unfinished it behaves like any normal overdue task the
  next day. (The vanish rule governs only *un-acted ghosts*, not tasks you've
  taken on.)

## Data model

All additions are optional / `#[serde(default)]`, so older files load and
re-serialize unchanged (AGENTS.md: model changes stay additive/backward-compatible).

### `Recurrence` (new)

`src-tauri/src/model.rs`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Recurrence {
    /// ISO weekday numbers 1=Mon..7=Sun. Must be non-empty. The "Weekdays"
    /// preset is [1,2,3,4,5].
    Weekly  { weekdays: Vec<u8> },
    /// Day-of-month 1..=31; clamps to the last day of shorter months.
    Monthly { day: u8 },
}
```

TS mirror in `src/lib/tauri.ts`:

```ts
export type Recurrence =
  | { kind: "weekly"; weekdays: number[] } // ISO 1=Mon..7=Sun
  | { kind: "monthly"; day: number };      // 1..31, clamps to month end
```

**Weekday convention:** stored as ISO 1=Mon..7=Sun in both Rust and TS. The
frontend converts to/from JS `Date.getDay()` (0=Sun..6=Sat) at the edges only.

### `TemplateTask` gains a schedule

```rust
// on TemplateTask
#[serde(default, skip_serializing_if = "Option::is_none")]
pub recurrence: Option<Recurrence>,
```

```ts
// on TemplateTask / NewTemplate / TemplateUpdate
recurrence?: Recurrence | null; // null in an update clears the schedule
```

### `Task` gains a recurrence link

So a promoted instance suppresses its own ghost for that day, and a device knows
which occurrence an instance already fills:

```rust
// on Task (and TaskCompat for load)
#[serde(default, skip_serializing_if = "Option::is_none")]
pub recurrence_of:   Option<String>,    // source template id
#[serde(default, skip_serializing_if = "Option::is_none")]
pub occurrence_date: Option<NaiveDate>, // the occurrence this instance fills
```

```ts
// on Task
recurrence_of?: string;
occurrence_date?: string; // YYYY-MM-DD
```

### Version

Bump `CURRENT_VERSION` 6 → 7, with the rationale comment in the existing style
(a pre-v7 build would drop the new template `recurrence` / task link fields on its
next write). New builds still read v≤6 files (the new fields default to absent).

## Occurrence + ghost computation (frontend, pure)

New module `src/lib/recurrence.ts`, unit-tested in isolation:

- `occursOn(rec: Recurrence, iso: string): boolean`
  - **weekly:** `rec.weekdays.includes(isoWeekday(iso))`.
  - **monthly:** `dayOfMonth(iso) === Math.min(rec.day, daysInMonth(iso))` (the clamp).
- A `GhostTask` shape used for rendering (not persisted):
  ```ts
  type GhostTask = {
    id: string;            // `ghost_<templateId>_<iso>` — stable per occurrence
    title: string;
    tag_ids: string[];     // copied from the template (drives tag membership + priority)
    templateId: string;
    occurrenceDate: string; // YYYY-MM-DD
  };
  ```

In `buildIndexes` (`src/state/indexes.ts`), expose:

```ts
ghostsForDate(iso: string): GhostTask[]
```

which returns, for every template with a `recurrence` that `occursOn(iso)`, a
`GhostTask` — **unless** an existing task already links to that occurrence
(`recurrence_of === template.id && occurrence_date === iso`, checked against all
`doc.tasks` incl. completed, so acting on a ghost removes it same-day). Build a
`Set` of `"<templateId>|<date>"` from `doc.tasks` once for cheap suppression.

### Where each view calls it

- **Today** (`TodayView`): `indexes.ghostsForDate(todayIso)`, rendered as ghost
  rows alongside the real Today list.
- **Upcoming** (`UpcomingView`): for each day `i` in `1..=horizon`,
  `indexes.ghostsForDate(iso)` merged into that day's group, sorted with the day's
  real tasks by effective priority (a ghost's tags supply its weight).
- **Tag view** (the `byTag` list / tag route): `ghostsForDate(todayIso)` filtered
  to ghosts whose `tag_ids` include the viewed tag id — **today only**.

`ghostsForDate` honors the logical day via the existing `todayIso`
(`day_start_hour`); Upcoming derives its days from that same `todayIso`.

## Promotion flow

New Rust command in `src-tauri/src/lib.rs` (added to `generate_handler!`):

```rust
spawn_recurring_task(template_id: String, occurrence_date: NaiveDate) -> Task
```

It copies `title`, `notes`, `tag_ids` from the template, sets
`due_date = occurrence_date`, stamps `recurrence_of` + `occurrence_date`,
`created_at = now`, persists, and returns the new `Task`. (Custom app commands
need no capabilities entry; the ACL note in AGENTS.md is about plugin permissions.)

TS api: `spawnRecurringTask(templateId, occurrenceDate) => invoke<Task>(...)`.

Frontend composes promote-then-apply in the store:

- **Check the box:** `spawnRecurringTask(...)` → `setTaskDone(newId, true)` → the
  instance lands in Archive like any finished task.
- **Open the row:** `spawnRecurringTask(...)` → open the task editor on the new id.
- **Start timer:** `spawnRecurringTask(...)` → `startTimer(newId)`.

After promotion the document refreshes; the ghost is suppressed because the new
task links to that occurrence.

## UI

- **Templates editor** (`TemplateRow` editor in `TemplatesView`): add a "Repeat"
  control — **None / Weekly / Monthly**.
  - *Weekly:* seven weekday toggles (Mon–Sun) + a "Weekdays" preset button;
    requires ≥1 day selected.
  - *Monthly:* a day-of-month input (1–31) with a "clamps to the month's last day"
    hint.
  - Lives in the **Templates view, not Settings** — does not trip the AGENTS.md
    "new Settings section needs approval" rule.
- **Ghost row:** a de-emphasized variant of `TaskRow` (reuse the existing
  lingering/de-emphasised styling) marked with a 🔁 indicator. Its checkbox and
  row-click are wired to the promotion flow. Rendered in Today, Upcoming, and the
  tag view.

## Edge cases

- **Monthly clamp:** the occurrence test uses `min(day, daysInMonth)`, so day 31
  fires on Feb 28/29, Apr 30, etc.
- **Day-start-hour:** "today" is the existing logical `todayIso`.
- **Same-day suppression:** promote-then-complete leaves a completed task linked to
  today's occurrence; suppression checks all tasks (incl. completed), so no
  duplicate ghost reappears.
- **Deleting a template:** already-spawned instances are independent tasks and
  remain; only new ghosts stop appearing.
- **Two devices, same occurrence:** each could promote independently, yielding two
  instances with the same `(template, date)` link. Rare; both are real tasks.
  De-duplication is out of scope for v1.
- **Manual spawn still works:** a template can be both manually spawned (existing
  button) and scheduled; the schedule is purely additive.

## Testing (TDD)

**Rust (`src-tauri`):**
- `Recurrence` serde round-trips (`weekly` / `monthly`); tagged-enum shape.
- A `TemplateTask` without `recurrence` and a `Task` without the link fields still
  load (backward compat) and re-serialize without the new keys.
- `spawn_recurring_task` copies template fields, sets `due_date = occurrence_date`,
  and stamps `recurrence_of` + `occurrence_date`.

**TypeScript (vitest):**
- `recurrence.test.ts`: `occursOn` for weekly (single day, Mon/Wed/Fri, weekday
  preset) and monthly including the short-month clamp; ISO/JS weekday conversion.
- `indexes.test.ts`: `ghostsForDate` emits expected ghosts; same-day suppression
  when a linked task exists; tag-view filtering by tag id.

## Out of scope (v1)

Every-N-days and interval multipliers; lingering/overdue ghosts; multi-day ghosts
in tag views; cross-device occurrence de-duplication; iCalendar RRULE
import/export.
