import type { Indexes } from "../state/indexes";
import { Task, isDone } from "./tauri";
import { addDaysIso, logicalDayOf } from "./dates";
import { elapsedMs } from "./time";
import type { HeatCell, Heatmap } from "./recurrence-heatmap";

/** Per-tag activity rollup over the trailing `days` window, shared by the Tag
 *  statistics tab and the Dashboard. Unlike the recurrence heatmap (which keys
 *  off a template's schedule), this is purely activity-based, so it is meaningful
 *  for ANY tag — recurring or not (#dashboard). */
export type TagAnalytics = {
  heat: Heatmap;
  totalSpentMs: number;
  scheduledDays: number;
  completedTasks: number;
  openTasks: number;
};

/**
 * Build the activity heatmap + summary stats for one tag.
 *
 * For each day in [today - days + 1 .. today] the cell is:
 *   - "done" : a task carrying the tag was completed that day.
 *   - "skip" : the tag was "scheduled" that day — a task started/was due, logged
 *              a time entry, or a recurring template's ghost fired (see
 *              `recurringScheduledDates`) — but nothing was completed.
 *   - "none" : no activity.
 */
export function computeTagAnalytics(
  tasks: Task[],
  todayIso: string,
  days: number,
  recurringScheduled: Set<string>,
  dayStartHour = 0,
): TagAnalytics {
  const now = Date.now();
  const start = addDaysIso(todayIso, -(days - 1));
  const completed = new Set<string>();
  const scheduled = new Set(recurringScheduled);
  let totalSpentMs = 0;
  let completedTasks = 0;
  let openTasks = 0;

  for (const task of tasks) {
    if (isDone(task)) completedTasks++;
    else openTasks++;

    const spent = elapsedMs(task, now);
    totalSpentMs += spent;

    for (const entry of task.time_entries ?? []) {
      const iso = logicalDayOf(entry.start, dayStartHour);
      if (iso >= start && iso <= todayIso) scheduled.add(iso);
    }
    if (task.completed_at) {
      const iso = logicalDayOf(task.completed_at, dayStartHour);
      if (iso >= start && iso <= todayIso) completed.add(iso);
    }
    for (const iso of [task.start_date, task.due_date]) {
      if (iso && iso >= start && iso <= todayIso) scheduled.add(iso);
    }
  }

  const cells: HeatCell[] = [];
  let done = 0;
  let count = 0;
  for (let i = 0; i < days; i++) {
    const iso = addDaysIso(start, i);
    let status: HeatCell["status"] = "none";
    if (completed.has(iso)) {
      status = "done";
      done++;
      count++;
    } else if (scheduled.has(iso)) {
      status = "skip";
      count++;
    }
    cells.push({ iso, status });
  }

  return {
    heat: { cells, scheduled: count, done, skipped: count - done },
    totalSpentMs,
    scheduledDays: count,
    completedTasks,
    openTasks,
  };
}

/** Days within the trailing `days` window on which a recurring template's ghost
 *  carrying `tagId` fires. Folds recurrence schedules into the activity heatmap
 *  so a tag used by recurring templates still shows its due-but-not-done days. */
export function recurringScheduledDates(indexes: Indexes, tagId: string, days: number): Set<string> {
  const scheduled = new Set<string>();
  const start = addDaysIso(indexes.todayIso, -(days - 1));
  for (let i = 0; i < days; i++) {
    const iso = addDaysIso(start, i);
    if (indexes.ghostsForDate(iso).some(ghost => ghost.tag_ids.includes(tagId))) {
      scheduled.add(iso);
    }
  }
  return scheduled;
}
