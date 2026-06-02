import { Document, SortOrder, Tag, Task, TemplateTask, isArchived, isDone } from "../lib/tauri";
import { isoLt, todayIso as computeTodayIso } from "../lib/dates";
import { dayStartHour } from "../lib/settings";

export type Indexes = {
  byTag:     Map<string, Task[]>;
  today:     (todayIso: string) => Task[];
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

/** Highest weight among a task's *resolvable* tags; 0 if it has none (or only unknown tags). */
export function effectivePriority(task: Task, tagsById: Map<string, Tag>): number {
  let max = 0;
  let seen = false;
  for (const id of task.tag_ids) {
    const tag = tagsById.get(id);
    if (!tag) continue;   // unknown/dangling id contributes nothing (no phantom weight-0)
    if (!seen || tag.priority > max) { max = tag.priority; seen = true; }
  }
  return max;
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
function sortTasks(tasks: Task[], order: SortOrder, tagsById: Map<string, Tag>): Task[] {
  const byWeightDesc = (a: Task, b: Task) =>
    effectivePriority(b, tagsById) - effectivePriority(a, tagsById);
  if (order === "date") {
    tasks.sort((a, b) => byOpenFirst(a, b) || byDateAsc(a, b) || byWeightDesc(a, b));
  } else {
    tasks.sort((a, b) => byOpenFirst(a, b) || byWeightDesc(a, b) || byDateAsc(a, b));
  }
  return tasks;
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
  const inToday = (t: Task, todayIso: string): boolean => {
    if (isDone(t)) {
      if (t.completed_at?.slice(0, 10) !== todayIso) return false;
      // Only keep it if it belonged to Today: scheduled today, or due on/before today.
      return t.start_date === todayIso || (t.due_date != null && t.due_date <= todayIso);
    }
    if (t.start_date === todayIso) return true;
    if (t.due_date) {
      if (t.due_date === todayIso) return true;
      if (isoLt(t.due_date, todayIso)) return true; // overdue, still open
    }
    return false;
  };

  const today = (todayIso: string): Task[] =>
    sortTasks(doc.tasks.filter(t => inToday(t, todayIso)), order, tagsById);

  // One logical "today" for the whole app, rolling over at the configured hour.
  const todayIso = computeTodayIso(new Date(), dayStartHour(doc.settings));

  return { byTag, today, todayIso, inbox, archived, templates, tagsById, tagsByName, tasks: active };
}
