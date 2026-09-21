import dayjs from "dayjs";

/** Match `FIRST_DAY_OF_WEEK_DEFAULT` in settings (Monday). */
const FIRST_DAY_OF_WEEK = 1;

export type EditorDatePickerCell = {
  iso: string;
  day: number;
  inMonth: boolean;
};

function weekPosition(iso: string, firstDayOfWeek: number): number {
  const [y, m, d] = iso.split("-").map(Number);
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return (js - firstDayOfWeek + 7) % 7;
}

/** Month grid for the task-editor in-DOM date popover (WebKitGTK #237). */
export function buildEditorDatePickerWeeks(
  yearMonth: string,
  firstDayOfWeek = FIRST_DAY_OF_WEEK,
): EditorDatePickerCell[][] {
  const monthStart = dayjs(`${yearMonth}-01`);
  const monthEnd = monthStart.endOf("month");
  let cursor = monthStart.subtract(weekPosition(monthStart.format("YYYY-MM-DD"), firstDayOfWeek), "day");
  const cells: EditorDatePickerCell[] = [];
  do {
    const iso = cursor.format("YYYY-MM-DD");
    cells.push({
      iso,
      day: cursor.date(),
      inMonth: cursor.month() === monthStart.month(),
    });
    cursor = cursor.add(1, "day");
  } while (cursor.isBefore(monthEnd, "day") || weekPosition(cursor.format("YYYY-MM-DD"), firstDayOfWeek) !== 0);

  const weeks: EditorDatePickerCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

export function shiftEditorDatePickerMonth(yearMonth: string, delta: number): string {
  return dayjs(`${yearMonth}-01`).add(delta, "month").format("YYYY-MM");
}

let closeOpenPopover: (() => void) | null = null;

/** Keep at most one task-editor date popover open (Start vs Due). */
export function claimEditorDatePopover(close: () => void): () => void {
  closeOpenPopover?.();
  closeOpenPopover = close;
  return () => {
    if (closeOpenPopover === close) closeOpenPopover = null;
  };
}

export function closeEditorDatePopovers(): void {
  closeOpenPopover?.();
  closeOpenPopover = null;
}
