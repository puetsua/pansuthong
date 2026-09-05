import dayjs from "dayjs";
import type { Task } from "./tauri";
import { isDone } from "./tauri";
import type { GhostTask } from "./recurrence";
import type { Indexes, Row } from "../state/indexes";

/** A day cell in the month grid with its computed task/ghost summary. */
export type CalendarDaySummary = {
  iso: string;
  tasks: Task[];
  ghosts: GhostTask[];
  totalCount: number;
};

export type CalendarCell = {
  iso: string;
  inMonth: boolean;
  day: number;
  summary: CalendarDaySummary;
};

const MAX_VISIBLE_DOTS = 3;

/** True when a task's start or due date falls on `iso` (Upcoming/Calendar rule). */
export function taskOnDate(task: Task, iso: string): boolean {
  return task.start_date === iso || task.due_date === iso;
}

/** Open (non-done) active tasks plus recurring ghosts for one calendar day. */
export function summarizeCalendarDay(indexes: Indexes, iso: string): CalendarDaySummary {
  const tasks = indexes.tasks.filter(t => !isDone(t) && taskOnDate(t, iso));
  const ghosts = indexes.ghostsForDate(iso);
  return { iso, tasks, ghosts, totalCount: tasks.length + ghosts.length };
}

/** Agenda rows for a selected day, ordered like Upcoming (weight merge). */
export function agendaRowsForDay(indexes: Indexes, iso: string): Row[] {
  const { tasks, ghosts } = summarizeCalendarDay(indexes, iso);
  return indexes.mergeRowsByWeight(tasks, ghosts);
}

/** Dot markers under a date: solid for tasks, hollow for ghosts (capped for density). */
export function calendarDots(summary: CalendarDaySummary): { kind: "task" | "ghost" }[] {
  const out: { kind: "task" | "ghost" }[] = [];
  for (const _ of summary.tasks) {
    if (out.length >= MAX_VISIBLE_DOTS) break;
    out.push({ kind: "task" });
  }
  for (const _ of summary.ghosts) {
    if (out.length >= MAX_VISIBLE_DOTS) break;
    out.push({ kind: "ghost" });
  }
  return out;
}

function weekPosition(iso: string, firstDayOfWeek: number): number {
  const [y, m, d] = iso.split("-").map(Number);
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return (js - firstDayOfWeek + 7) % 7;
}

/** Build a month grid (week rows) including leading/trailing out-of-month padding days. */
export function buildMonthGrid(
  yearMonth: string,
  firstDayOfWeek: number,
  indexes: Indexes,
): CalendarCell[][] {
  const monthStart = dayjs(`${yearMonth}-01`);
  const monthEnd = monthStart.endOf("month");
  let cursor = monthStart.subtract(weekPosition(monthStart.format("YYYY-MM-DD"), firstDayOfWeek), "day");
  const cells: CalendarCell[] = [];
  do {
    const iso = cursor.format("YYYY-MM-DD");
    cells.push({
      iso,
      inMonth: cursor.month() === monthStart.month(),
      day: cursor.date(),
      summary: summarizeCalendarDay(indexes, iso),
    });
    cursor = cursor.add(1, "day");
  } while (cursor.isBefore(monthEnd, "day") || weekPosition(cursor.format("YYYY-MM-DD"), firstDayOfWeek) !== 0);

  const weeks: CalendarCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** Shift a YYYY-MM month string by `delta` months. */
export function shiftMonth(yearMonth: string, delta: number): string {
  return dayjs(`${yearMonth}-01`).add(delta, "month").format("YYYY-MM");
}
