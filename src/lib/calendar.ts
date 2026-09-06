import dayjs from "dayjs";
import type { Task } from "./tauri";
import { isDone } from "./tauri";
import type { GhostTask } from "./recurrence";
import type { Indexes, Row } from "../state/indexes";
import { addDaysIso } from "./dates";

export type CalendarMode = "month" | "week" | "day";

/** A day cell in the month/week grid with its computed task/ghost summary. */
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

/** Max task chips shown in a month cell before a +N overflow control. */
export const MAX_MONTH_CHIPS = 3;

/** True when a task's start or due date falls on `iso`. */
export function taskOnDate(task: Task, iso: string): boolean {
  return task.start_date === iso || task.due_date === iso;
}

/** Open (non-done) active tasks plus recurring ghosts for one calendar day. */
export function summarizeCalendarDay(indexes: Indexes, iso: string): CalendarDaySummary {
  const tasks = indexes.tasks.filter(t => !isDone(t) && taskOnDate(t, iso));
  const ghosts = indexes.ghostsForDate(iso);
  return { iso, tasks, ghosts, totalCount: tasks.length + ghosts.length };
}

/** Agenda rows for a day, ordered by tag weight (same rule as the old Upcoming list). */
export function agendaRowsForDay(indexes: Indexes, iso: string): Row[] {
  const { tasks, ghosts } = summarizeCalendarDay(indexes, iso);
  return indexes.mergeRowsByWeight(tasks, ghosts);
}

export function chipLabel(row: Row): string {
  return row.kind === "task" ? row.task.title : row.ghost.title;
}

export function isGhostRow(row: Row): boolean {
  return row.kind === "ghost";
}

/** Visible chips plus overflow count for dense month cells. */
export function monthChipSlice(rows: Row[], max = MAX_MONTH_CHIPS): { visible: Row[]; overflow: number } {
  if (rows.length <= max) return { visible: rows, overflow: 0 };
  return { visible: rows.slice(0, max), overflow: rows.length - max };
}

export function weekPosition(iso: string, firstDayOfWeek: number): number {
  const [y, m, d] = iso.split("-").map(Number);
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return (js - firstDayOfWeek + 7) % 7;
}

/** ISO date of the week start containing `iso`, honoring `firstDayOfWeek`. */
export function weekStartIso(iso: string, firstDayOfWeek: number): string {
  return addDaysIso(iso, -weekPosition(iso, firstDayOfWeek));
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

/** Seven consecutive days starting at `weekStart` (YYYY-MM-DD). */
export function buildWeekDays(weekStart: string, indexes: Indexes): CalendarCell[] {
  return Array.from({ length: 7 }, (_, i) => {
    const iso = addDaysIso(weekStart, i);
    return {
      iso,
      inMonth: true,
      day: Number(iso.slice(8, 10)),
      summary: summarizeCalendarDay(indexes, iso),
    };
  });
}

/** Shift a YYYY-MM month string by `delta` months. */
export function shiftMonth(yearMonth: string, delta: number): string {
  return dayjs(`${yearMonth}-01`).add(delta, "month").format("YYYY-MM");
}

/** Shift an ISO date by `weeks` whole weeks. */
export function shiftWeek(iso: string, weeks: number): string {
  return addDaysIso(iso, weeks * 7);
}

/** YYYY-MM month key for an ISO date. */
export function monthOf(iso: string): string {
  return iso.slice(0, 7);
}

/** Move `focusIso` by `delta` months, keeping the day when possible (clamped). */
export function shiftFocusMonth(focusIso: string, delta: number): string {
  return dayjs(focusIso).add(delta, "month").format("YYYY-MM-DD");
}
