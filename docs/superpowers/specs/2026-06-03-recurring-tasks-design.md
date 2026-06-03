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
- **The link is a tag the user assigns** (AGENTS.md: tags are the core data, so
  the link rides on them rather than on new `Task` fields). A template recurs only
  when it has both a schedule **and ≥1 tag**. The ghost for a recurring template on
  date `D` is hidden when **any task carrying one of the template's tags has
  `due_date == D`** — the instance's `due_date` (= occurrence date) supplies the
  *when*, the shared tag supplies the *which*. No new `Task` or `Tag` fields.
- **Shared tag = alternatives (a feature, not a bug):** several recurring templates
  sharing a tag act as same-day alternatives — acting on any one clears the others'
  ghosts for that date. Example: daily "push-ups" and "sit-ups" both tagged
  `exercise` → both ghost into Today; do either and the rest clear ("I did my
  exercise today").

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

### `Task` — no new fields

The recurrence link is **a tag**, not a stored reference, so `Task` is unchanged.
A spawned instance already inherits the template's `tag_ids` (existing behavior);
that inherited tag *is* the link. Occurrence identity comes from the instance's
`due_date`. This keeps the model change to the single `TemplateTask.recurrence`
field and avoids a parallel "recurrence reference" concept beside tags.

### Version

Bump `CURRENT_VERSION` 6 → 7, with the rationale comment in the existing style
(a pre-v7 build would drop the new template `recurrence` field on its next write).
New builds still read v≤6 files (the field defaults to absent).

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

which returns, for every template that (a) has a `recurrence`, (b) has ≥1 tag, and
(c) `occursOn(iso)`, a `GhostTask` — **unless** a task on that date already covers
it: any `doc.tasks` entry (open or completed) with `due_date === iso` that shares
at least one tag with the template. Precompute, in one pass over `doc.tasks`, a
`Map<dateIso, Set<tagId>>` of "tags that have a task due that day", then suppress a
ghost when the template's tag set intersects `dueTagsByDate.get(iso)`. Acting on a
ghost spawns a task with the template's tags due on `iso`, so it self-suppresses on
the next refresh — and same-tag siblings (the alternatives case) suppress together.

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
`due_date = occurrence_date`, `created_at = now`, persists, and returns the new
`Task`. No link fields are stamped — the copied `tag_ids` + `due_date` *are* the
link. (Custom app commands need no capabilities entry; the ACL note in AGENTS.md
is about plugin permissions.)

TS api: `spawnRecurringTask(templateId, occurrenceDate) => invoke<Task>(...)`.

Frontend composes promote-then-apply in the store:

- **Check the box:** `spawnRecurringTask(...)` → `setTaskDone(newId, true)` → the
  instance lands in Archive like any finished task.
- **Open the row:** `spawnRecurringTask(...)` → open the task editor on the new id.
- **Start timer:** `spawnRecurringTask(...)` → `startTimer(newId)`.

After promotion the document refreshes; the ghost is suppressed because the new
task shares the template's tag and is due on that occurrence date.

## UI

- **Templates editor** (`TemplateRow` editor in `TemplatesView`): add a "Repeat"
  control — **None / Weekly / Monthly**.
  - *Weekly:* seven weekday toggles (Mon–Sun) + a "Weekdays" preset button;
    requires ≥1 day selected.
  - *Monthly:* a day-of-month input (1–31) with a "clamps to the month's last day"
    hint.
  - Because recurrence needs a tag to work, the editor **requires ≥1 tag** when a
    schedule is set (and the row surfaces a hint like "add a tag so it can recur").
    A schedule with no tag is inert (no ghost) — the UI prevents that state rather
    than silently dropping ghosts.
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
- **Same-day suppression:** promote-then-complete leaves a completed task tagged
  and due today; suppression scans all tasks (incl. completed), so no duplicate
  ghost reappears.
- **Over-suppression by same-tagged tasks:** *any* task due on `D` bearing the
  template's tag hides the ghost — including an unrelated manual task or another
  recurring template's instance. This is the intended "alternatives" behavior and
  the price of a tag-based link. Mitigation guidance: use a tag that is reasonably
  specific to the recurring activity (e.g. `exercise`, `rent`) rather than a broad
  catch-all tag.
- **Deleting a template:** already-spawned instances are independent tasks and
  remain; only new ghosts stop appearing.
- **Two devices, same occurrence:** each could promote independently, yielding two
  instances tagged + due the same day. Rare; both are real tasks. De-duplication is
  out of scope for v1.
- **Manual spawn still works:** a template can be both manually spawned (existing
  button) and scheduled; the schedule is purely additive.

## Testing (TDD)

**Rust (`src-tauri`):**
- `Recurrence` serde round-trips (`weekly` / `monthly`); tagged-enum shape.
- A `TemplateTask` without `recurrence` still loads (backward compat) and
  re-serializes without the key.
- `spawn_recurring_task` copies template `title`/`notes`/`tag_ids` and sets
  `due_date = occurrence_date`.

**TypeScript (vitest):**
- `recurrence.test.ts`: `occursOn` for weekly (single day, Mon/Wed/Fri, weekday
  preset) and monthly including the short-month clamp; ISO/JS weekday conversion.
- `indexes.test.ts`: `ghostsForDate` emits expected ghosts; a tagless recurring
  template emits none; suppression when a same-tag task is due that day; the
  alternatives case (two same-tag templates, acting on one clears both); tag-view
  filtering by tag id.

## Out of scope (v1)

Every-N-days and interval multipliers; lingering/overdue ghosts; multi-day ghosts
in tag views; cross-device occurrence de-duplication; iCalendar RRULE
import/export.
