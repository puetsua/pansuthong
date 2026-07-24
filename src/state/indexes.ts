import { Document, SortOrder, Tag, Task, TemplateTask, isArchived, isDone } from "../lib/tauri";
import { addDaysIso, isoLt, logicalDayOf, todayIso as computeTodayIso } from "../lib/dates";
import { dayStartHour } from "../lib/settings";
import { GhostTask, occursOn } from "../lib/recurrence";

/** A row in a date-based view: either a real task or a computed recurring ghost.
 *  Letting the two share one sorted sequence keeps a ghost in the same slot its
 *  promoted task takes, so promoting it doesn't reshuffle the list (#9). */
export type Row =
  | { kind: "task"; task: Task }
  | { kind: "ghost"; ghost: GhostTask };

export type Indexes = {
  byTag:     Map<string, Task[]>;
  today:     (todayIso: string) => Task[];
  /** Recurring-template ghost rows for a given day (YYYY-MM-DD); computed, never stored. */
  ghostsForDate: (iso: string) => GhostTask[];
  /** Tasks + ghosts merged into one list sorted by the configured order, so a ghost
   *  sits where its promoted task would (used by Today and tag views). */
  mergeRows: (tasks: Task[], ghosts: GhostTask[]) => Row[];
  /** Tasks + ghosts merged by tag weight only, preserving input order within a tie
   *  (used by Upcoming, which orders each day by weight). */
  mergeRowsByWeight: (tasks: Task[], ghosts: GhostTask[]) => Row[];
  /** The current logical day (YYYY-MM-DD), honoring the day-start-hour setting. */
  todayIso:  string;
  inbox:     Task[];
  /** Archived tasks (newest-archived first); excluded from every active list above. */
  archived:     Task[];
  /** Reusable templates (their own list); never part of the active lists above. */
  templates:    TemplateTask[];
  tagsById:     Map<string, Tag>;
  tagsByName:   Map<string, Tag>;
  /** Active (non-archived) tasks in document order. */
  tasks:        Task[];
};

/** Highest weight among a set of *resolvable* tags; 0 if none resolve. */
function priorityOfTags(tagIds: string[], tagsById: Map<string, Tag>): number {
  let max = 0;
  let seen = false;
  for (const id of tagIds) {
    const tag = tagsById.get(id);
    if (!tag) continue;   // unknown/dangling id contributes nothing (no phantom weight-0)
    if (!seen || tag.priority > max) { max = tag.priority; seen = true; }
  }
  return max;
}

/** Highest weight among a task's *resolvable* tags; 0 if it has none (or only unknown tags). */
export function effectivePriority(task: Task, tagsById: Map<string, Tag>): number {
  return priorityOfTags(task.tag_ids, tagsById);
}

/** "date[Ttime]" so same-day tasks order by time; missing time = start-of-day (#93). */
function moment(date?: string, time?: string): string | undefined {
  return date ? `${date}T${time || "00:00"}` : undefined;
}

/** Earliest of start/due as a comparable moment; undefined when the task has neither. */
function sortDate(task: Task): string | undefined {
  const s = moment(task.start_date, task.start_time);
  const d = moment(task.due_date, task.due_time);
  if (s && d) return s < d ? s : d;
  return s ?? d;
}

function byDateAsc(a: Task, b: Task): number {
  const da = sortDate(a), db = sortDate(b);
  if (da === db) return 0;
  if (da === undefined) return 1;   // undated tasks sort last
  if (db === undefined) return -1;
  return da < db ? -1 : 1;
}

/** Open tasks before done ones; equal `done` is a tie. */
function byOpenFirst(a: Task, b: Task): number {
  const da = isDone(a), db = isDone(b);
  return da === db ? 0 : da ? 1 : -1;
}

/** Number of not-yet-done ("remaining work") tasks in a list. */
export function openCount(tasks: Task[]): number {
  let n = 0;
  for (const t of tasks) if (!isDone(t)) n++;
  return n;
}

/**
 * Sort a task list in place by the configured order. `Array.prototype.sort` is
 * stable, so ties fall back to the list's original (insertion) order. Completed
 * tasks always sink below open ones (a done high-weight task does not stay pinned).
 *   priority: done last -> weight desc -> date asc -> insertion
 *   date:     done last -> date asc -> weight desc -> insertion
 */
/** Sort a task list in place by the configured order (used by active views and Search). */
export function sortTasks(tasks: Task[], order: SortOrder, tagsById: Map<string, Tag>): Task[] {
  const byWeightDesc = (a: Task, b: Task) =>
    effectivePriority(b, tagsById) - effectivePriority(a, tagsById);
  if (order === "date") {
    tasks.sort((a, b) => byOpenFirst(a, b) || byDateAsc(a, b) || byWeightDesc(a, b));
  } else {
    tasks.sort((a, b) => byOpenFirst(a, b) || byWeightDesc(a, b) || byDateAsc(a, b));
  }
  return tasks;
}

// ── Mixed task/ghost rows ───────────────────────────────────────────────────
// A ghost sorts as the open task it becomes when promoted: start_date = its
// occurrence date, plus its template due date and tags. Comparing rows by that
// same key keeps a ghost in the slot its promotion would land in.
type RowKey = { tagIds: string[]; date?: string; done: boolean };

function rowKey(row: Row): RowKey {
  if (row.kind === "task") {
    const t = row.task;
    const s = moment(t.start_date, t.start_time);
    const d = moment(t.due_date, t.due_time);
    return { tagIds: t.tag_ids, date: s && d ? (s < d ? s : d) : (s ?? d), done: isDone(t) };
  }
  const g = row.ghost;
  // Mirror the task branch exactly: a promoted ghost becomes a task with
  // start_date = occurrenceDate and due_date = g.due_date, so key it on the
  // earliest of the two. (occurrenceDate is always set, so the previous
  // `?? moment(g.due_date)` fallback was dead code.)
  const s = moment(g.occurrenceDate);
  const d = moment(g.due_date);
  return { tagIds: g.tag_ids, date: s && d ? (s < d ? s : d) : (s ?? d), done: false };
}

function rowOpenFirst(a: RowKey, b: RowKey): number {
  return a.done === b.done ? 0 : a.done ? 1 : -1;
}
function rowDateAsc(a: RowKey, b: RowKey): number {
  if (a.date === b.date) return 0;
  if (a.date === undefined) return 1;
  if (b.date === undefined) return -1;
  return a.date < b.date ? -1 : 1;
}

/** Build rows with real tasks first, then ghosts — so a ghost ties *after* a
 *  same-key task, matching where its promoted (newly-appended) task would sort. */
function toRows(tasks: Task[], ghosts: GhostTask[]): Row[] {
  return [
    ...tasks.map((task): Row => ({ kind: "task", task })),
    ...ghosts.map((ghost): Row => ({ kind: "ghost", ghost })),
  ];
}

function sortRowsByOrder(rows: Row[], order: SortOrder, tagsById: Map<string, Tag>): Row[] {
  const k = new Map(rows.map(r => [r, rowKey(r)]));
  const w = (r: Row) => priorityOfTags(k.get(r)!.tagIds, tagsById);
  const byWeightDesc = (a: Row, b: Row) => w(b) - w(a);
  const byDate = (a: Row, b: Row) => rowDateAsc(k.get(a)!, k.get(b)!);
  const byOpen = (a: Row, b: Row) => rowOpenFirst(k.get(a)!, k.get(b)!);
  if (order === "date") rows.sort((a, b) => byOpen(a, b) || byDate(a, b) || byWeightDesc(a, b));
  else                  rows.sort((a, b) => byOpen(a, b) || byWeightDesc(a, b) || byDate(a, b));
  return rows;
}

function sortRowsByWeight(rows: Row[], tagsById: Map<string, Tag>): Row[] {
  const w = (r: Row) => priorityOfTags(rowKey(r).tagIds, tagsById);
  rows.sort((a, b) => w(b) - w(a));
  return rows;
}

export function buildIndexes(doc: Document): Indexes {
  const tagsById = new Map(doc.tags.map(t => [t.id, t]));
  const order: SortOrder = doc.settings.sort_order === "date" ? "date" : "priority";

  // Archived tasks (#23) are non-destructively hidden: every active list is built
  // from this filtered set, so the exclusion happens once, here. Templates (#71)
  // live in their own list (doc.template_tasks), so they're never in doc.tasks.
  const active = doc.tasks.filter(t => !isArchived(t));

  const byTag = new Map<string, Task[]>();
  for (const tag of doc.tags) byTag.set(tag.id, []);
  for (const task of active) {
    for (const tagId of task.tag_ids) {
      byTag.get(tagId)?.push(task);
    }
  }
  for (const arr of byTag.values()) sortTasks(arr, order, tagsById);

  // Inbox catches tasks that no pinned-tag sidebar view surfaces: those with no
  // pinned tag. Untagged tasks qualify trivially; a task tagged only with
  // unpinned tags lands here too (otherwise it would be invisible). An unknown
  // tag id is treated as unpinned, matching its "behaves as untagged" handling.
  const inbox = sortTasks(
    active.filter(t => !t.tag_ids.some(id => tagsById.get(id)?.pinned)),
    order, tagsById,
  );

  // Most-recently-completed first (fall back to insertion order when unstamped).
  // completed_at is an ISO-8601 string carrying a local offset, so compare by the
  // parsed instant rather than lexically (offsets make string order != time order).
  const instant = (t: Task): number => t.completed_at ? new Date(t.completed_at).getTime() : 0;
  const archived = doc.tasks
    .filter(t => isArchived(t))
    .sort((a, b) => instant(b) - instant(a));

  // Templates in document order; surfaced only in the Templates view.
  const templates = doc.template_tasks;

  const tagsByName = new Map<string, Tag>();
  for (const t of doc.tags) tagsByName.set(t.name.toLowerCase(), t);

  // A task completed today lingers in Today (de-emphasised, sorted to the bottom)
  // until the day rolls over, so a mistaken completion can be undone in place;
  // older completions are gone. Built from `doc.tasks` (not `active`) so done
  // tasks are reachable. Other views drop completed tasks on the next visit
  // instead — that's view-local state, not here.
  // One day-start hour for the whole app: it shifts both the current logical day
  // (todayIso, below) and the day a completion is attributed to, so a task finished
  // just after midnight with a later day-start still belongs to the same logical day.
  const dsh = dayStartHour(doc.settings);

  // True when today falls on or within a task's time range, ignoring done-ness. A
  // task with a start_date opens a span beginning that day: with a due_date it ends
  // at the due date, without one it runs open-endedly into the future, so it shows
  // every day from its start onward until completed. A due-only task shows on its
  // due day and after (overdue).
  const coversToday = (t: Task, todayIso: string): boolean => {
    if (t.start_date) return !isoLt(todayIso, t.start_date);    // start <= today (open-ended or within span)
    return t.due_date != null && t.due_date <= todayIso;        // due today or overdue
  };

  // Time tracking pulls an open task into Today independent of its dates: a running
  // timer (open entry) shows the task you're working on *now*, and a task tracked
  // earlier in today's logical day stays put after the timer stops — until the day
  // rolls over. Entry timestamps are local ISO strings, so logicalDayOf attributes
  // them the same way completions are (honoring the day-start hour). Both start and
  // end are checked so an overnight session stopped this morning still counts.
  const trackedToday = (t: Task, todayIso: string): boolean =>
    (t.time_entries ?? []).some(e =>
      e.end == null
      || logicalDayOf(e.start, dsh) === todayIso
      || logicalDayOf(e.end, dsh) === todayIso,
    );

  const inToday = (t: Task, todayIso: string): boolean => {
    // Done tasks linger only on the logical day they were completed; older
    // completions drop out. Membership itself matches the open rule: date
    // coverage or today's tracking (#142 — track-only completes used to vanish).
    if (isDone(t) && logicalDayOf(t.completed_at ?? "", dsh) !== todayIso) return false;
    return coversToday(t, todayIso) || trackedToday(t, todayIso);
  };

  const today = (todayIso: string): Task[] =>
    sortTasks(doc.tasks.filter(t => inToday(t, todayIso)), order, tagsById);

  // One logical "today" for the whole app, rolling over at the configured hour.
  const todayIso = computeTodayIso(new Date(), dsh);

  // Recurring templates project ghost rows into the date-based views (#9). Each
  // recurring template designates one `recurrence_tag_id`; a ghost is suppressed
  // when a real task *starting* that date carries that single tag (the template's
  // other tags don't count). A promoted instance is stamped with `start_date =
  // occurrence date`, so it self-suppresses. Templates sharing the same recurrence
  // tag therefore act as same-day alternatives — acting on one clears the others.
  const recurringTemplates = (doc.template_tasks ?? []).filter(t => t.recurrence && t.recurrence_tag_id);
  // startDate -> set of tag ids carried by tasks starting that day (open or completed).
  const startTagsByDate = new Map<string, Set<string>>();
  for (const t of doc.tasks) {
    if (!t.start_date) continue;
    let set = startTagsByDate.get(t.start_date);
    if (!set) { set = new Set(); startTagsByDate.set(t.start_date, set); }
    for (const id of t.tag_ids) set.add(id);
  }
  const ghostsForDate = (iso: string): GhostTask[] => {
    const covered = startTagsByDate.get(iso);
    const out: GhostTask[] = [];
    for (const tmpl of recurringTemplates) {
      if (!occursOn(tmpl.recurrence!, iso)) continue;
      if (tmpl.recurrence_start_date && iso < tmpl.recurrence_start_date) continue;
      if (covered && covered.has(tmpl.recurrence_tag_id!)) continue; // already done that day
      out.push({
        id: `ghost_${tmpl.id}_${iso}`,
        title: tmpl.title,
        notes: tmpl.notes,
        tag_ids: tmpl.tag_ids,
        due_date: tmpl.due_offset_days != null ? addDaysIso(iso, tmpl.due_offset_days) : undefined,
        templateId: tmpl.id,
        occurrenceDate: iso,
      });
    }
    return out;
  };

  const mergeRows = (tasks: Task[], ghosts: GhostTask[]): Row[] =>
    sortRowsByOrder(toRows(tasks, ghosts), order, tagsById);
  const mergeRowsByWeight = (tasks: Task[], ghosts: GhostTask[]): Row[] =>
    sortRowsByWeight(toRows(tasks, ghosts), tagsById);

  return { byTag, today, ghostsForDate, mergeRows, mergeRowsByWeight, todayIso, inbox, archived, templates, tagsById, tagsByName, tasks: active };
}
