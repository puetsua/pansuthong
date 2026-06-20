import { Task, TemplateTask } from "./tauri";
import { occursOn } from "./recurrence";
import { addDaysIso } from "./dates";

export type HeatStatus = "done" | "skip" | "none";

export type HeatCell = {
  iso: string;       // YYYY-MM-DD
  status: HeatStatus;
};

export type Heatmap = {
  cells: HeatCell[];          // oldest .. today, always `days` long
  scheduled: number;          // occurrences the rule fires on within range (done + skip)
  done: number;               // scheduled occurrences with a completed same-tag task that day
  skipped: number;            // scheduled occurrences not done
};

/**
 * Recurrence dashboard heatmap for one recurring template (#recurrence-dashboard).
 *
 * For each day in [today - days + 1 .. today] the cell is:
 *   - "done"  : the rule fires that day AND a task (open or completed) starting
 *               that day carries the template's recurrence tag, and that task is
 *               completed. Mirrors the ghost-suppression check in `indexes.ts`,
 *               so a promoted-then-completed occurrence reads as done.
 *   - "skip"  : the rule fires that day (iso <= today) but no such completed task
 *               exists — the occurrence happened (or is due today) but wasn't
 *               acted on. A spawned-but-still-open task counts here too.
 *   - "none"  : the rule does not fire that day.
 *
 * Only recurring templates (having `recurrence` and `recurrence_tag_id`) are
 * meaningful; the view's picker filters those out upstream, but this helper
 * returns an empty day-of-"none" map for a non-recurring template so it never
 * throws. Future days are out of range (the range ends at today), so every
 * firing day within range is treated as a past-or-today occurrence.
 */
export function computeHeatmap(args: {
  template: TemplateTask;
  tasks: Task[];
  todayIso: string;
  days: number;
}): Heatmap {
  const { template, tasks, todayIso, days } = args;
  const rec = template.recurrence;
  const recTag = template.recurrence_tag_id;

  // Index tasks by their start_date -> Set of tag ids, once. Only a task
  // *starting* a day the rule fires and carrying the recurrence tag is a
  // candidate done occurrence (matches the ghost flow's suppression rule).
  const startedTagsByDate = new Map<string, Map<string, boolean>>();
  for (const t of tasks) {
    if (!t.start_date) continue;
    let m = startedTagsByDate.get(t.start_date);
    if (!m) { m = new Map(); startedTagsByDate.set(t.start_date, m); }
    const done = t.completed_at != null;
    for (const id of t.tag_ids) {
      // A recurrence tag may be carried by multiple same-day tasks; record done
      // as soon as ANY one of them is completed, so re-opening one doesn't flip
      // the cell back to skip when a sibling stays done.
      const prev = m.get(id);
      if (prev !== true) m.set(id, done);
    }
  }

  const start = addDaysIso(todayIso, -(days - 1));
  const cells: HeatCell[] = [];
  let done = 0;
  let scheduled = 0;

  const startDate = template.recurrence_start_date;

  for (let i = 0; i < days; i++) {
    const iso = addDaysIso(start, i);
    let status: HeatStatus = "none";
    if (rec && recTag && (!startDate || iso >= startDate) && occursOn(rec, iso)) {
      const started = startedTagsByDate.get(iso)?.get(recTag);
      if (started === true) {
        status = "done";
        done++;
      } else {
        // Rule fires today or earlier (range is capped at today) and no
        // completed occurrence: an occurrence that wasn't acted on.
        status = "skip";
      }
      scheduled++;
    }
    cells.push({ iso, status });
  }

  return { cells, scheduled, done, skipped: scheduled - done };
}