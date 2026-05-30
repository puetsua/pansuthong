import { Document, SortOrder, Tag, Task } from "../lib/tauri";
import { isoLt } from "../lib/dates";

export type Indexes = {
  byTag:     Map<string, Task[]>;
  today:     (todayIso: string) => Task[];
  inbox:     Task[];
  tagsById:     Map<string, Tag>;
  tagsByName:   Map<string, Tag>;
  tasks:        Task[];
};

/** Highest weight among a task's tags; 0 if it has none (or only unknown tags). */
export function effectivePriority(task: Task, tagsById: Map<string, Tag>): number {
  let max = 0;
  let seen = false;
  for (const id of task.tag_ids) {
    const w = tagsById.get(id)?.priority ?? 0;
    if (!seen || w > max) { max = w; seen = true; }
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

/**
 * Sort a task list in place by the configured order. `Array.prototype.sort` is
 * stable, so ties fall back to the list's original (insertion) order.
 *   priority: weight desc -> date asc -> insertion
 *   date:     date asc -> weight desc -> insertion
 */
function sortTasks(tasks: Task[], order: SortOrder, tagsById: Map<string, Tag>): Task[] {
  const byWeightDesc = (a: Task, b: Task) =>
    effectivePriority(b, tagsById) - effectivePriority(a, tagsById);
  if (order === "date") {
    tasks.sort((a, b) => byDateAsc(a, b) || byWeightDesc(a, b));
  } else {
    tasks.sort((a, b) => byWeightDesc(a, b) || byDateAsc(a, b));
  }
  return tasks;
}

export function buildIndexes(doc: Document): Indexes {
  const tagsById = new Map(doc.tags.map(t => [t.id, t]));
  const order: SortOrder = doc.settings.sort_order === "date" ? "date" : "priority";

  const byTag = new Map<string, Task[]>();
  for (const tag of doc.tags) byTag.set(tag.id, []);
  for (const task of doc.tasks) {
    for (const tagId of task.tag_ids) {
      byTag.get(tagId)?.push(task);
    }
  }
  for (const arr of byTag.values()) sortTasks(arr, order, tagsById);

  const inbox = sortTasks(doc.tasks.filter(t => t.tag_ids.length === 0), order, tagsById);

  const tagsByName = new Map<string, Tag>();
  for (const t of doc.tags) tagsByName.set(t.name.toLowerCase(), t);

  const today = (todayIso: string): Task[] => {
    const list = doc.tasks.filter(t => {
      if (t.scheduled_date === todayIso) return true;
      if (t.due_date) {
        if (t.due_date === todayIso) return true;
        if (isoLt(t.due_date, todayIso) && !t.done) return true;
      }
      return false;
    });
    return sortTasks(list, order, tagsById);
  };

  return { byTag, today, inbox, tagsById, tagsByName, tasks: doc.tasks };
}
