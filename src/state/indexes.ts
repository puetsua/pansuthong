import { Document, SortOrder, Tag, Task } from "../lib/tauri";
import { isoLt } from "../lib/dates";

export type Indexes = {
  byTag:     Map<string, Task[]>;
  today:     (todayIso: string) => Task[];
  inbox:     Task[];
  /** Archived tasks (newest-archived first); excluded from every active list above. */
  archived:     Task[];
  /** Template tasks (reusable blueprints); excluded from every active list above. */
  templates:    Task[];
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

/** Earliest of scheduled/due as an ISO string; undefined when the task has neither. */
function sortDate(task: Task): string | undefined {
  const s = task.scheduled_date, d = task.due_date;
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
  return a.done === b.done ? 0 : a.done ? 1 : -1;
}

/** Number of not-yet-done ("remaining work") tasks in a list. */
export function openCount(tasks: Task[]): number {
  let n = 0;
  for (const t of tasks) if (!t.done) n++;
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

  // Archived tasks (#23) and templates (#71) are both non-destructively hidden:
  // every active list is built from this filtered set, so the exclusion happens
  // once, here.
  const active = doc.tasks.filter(t => !t.archived && !t.is_template);

  const byTag = new Map<string, Task[]>();
  for (const tag of doc.tags) byTag.set(tag.id, []);
  for (const task of active) {
    for (const tagId of task.tag_ids) {
      byTag.get(tagId)?.push(task);
    }
  }
  for (const arr of byTag.values()) sortTasks(arr, order, tagsById);

  const inbox = sortTasks(active.filter(t => t.tag_ids.length === 0), order, tagsById);

  // Most-recently-archived first (fall back to completion/insertion when unstamped).
  const archived = doc.tasks
    .filter(t => t.archived)
    .sort((a, b) => (b.archived_at ?? b.completed_at ?? 0) - (a.archived_at ?? a.completed_at ?? 0));

  // Templates in document order; surfaced only in the Templates view.
  const templates = doc.tasks.filter(t => t.is_template);

  const tagsByName = new Map<string, Tag>();
  for (const t of doc.tags) tagsByName.set(t.name.toLowerCase(), t);

  const today = (todayIso: string): Task[] => {
    const list = active.filter(t => {
      if (t.scheduled_date === todayIso) return true;
      if (t.due_date) {
        if (t.due_date === todayIso) return true;
        if (isoLt(t.due_date, todayIso) && !t.done) return true;
      }
      return false;
    });
    return sortTasks(list, order, tagsById);
  };

  return { byTag, today, inbox, archived, templates, tagsById, tagsByName, tasks: active };
}
