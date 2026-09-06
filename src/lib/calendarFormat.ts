import type { TFunction } from "i18next";
import { addDaysIso, formatIsoDate, formatIsoYearMonth, type DateFormat } from "./dates";

export const CALENDAR_WEEKDAY_KEYS = [
  "taskEditor.weekdaySun", "taskEditor.weekdayMon", "taskEditor.weekdayTue",
  "taskEditor.weekdayWed", "taskEditor.weekdayThu", "taskEditor.weekdayFri",
  "taskEditor.weekdaySat",
] as const;

/** Weekday label from i18n (matches month grid / day strip), not browser locale. */
export function weekdayLabelForIso(iso: string, t: TFunction): string {
  const js = new Date(`${iso}T12:00:00`).getDay();
  return t(CALENDAR_WEEKDAY_KEYS[js]);
}

export function calendarMonthTitle(yearMonth: string, dateFmt: DateFormat, locale: string): string {
  return formatIsoYearMonth(yearMonth, dateFmt, locale);
}

export function calendarWeekRange(
  weekStart: string,
  dateFmt: DateFormat,
  locale: string,
  t: TFunction,
): string {
  const end = addDaysIso(weekStart, 6);
  return t("calendar.weekRange", {
    start: formatIsoDate(weekStart, dateFmt, locale),
    end: formatIsoDate(end, dateFmt, locale),
  });
}

export function calendarDayTitle(
  iso: string,
  todayIso: string,
  dateFmt: DateFormat,
  locale: string,
  t: TFunction,
): string {
  const base = `${formatIsoDate(iso, dateFmt, locale)} (${weekdayLabelForIso(iso, t)})`;
  if (iso === todayIso) return `${base} · ${t("calendar.today")}`;
  return base;
}
