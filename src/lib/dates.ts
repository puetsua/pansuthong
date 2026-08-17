import { MS_PER_DAY, MS_PER_HOUR } from "./duration";

export type DateFormat =
  | "locale"
  | "locale_short"
  | "locale_long"
  | "locale_full"
  | "iso"
  | "slash_ymd"
  | "dot_ymd"
  | "slash_mdy"
  | "slash_dmy"
  | "dot_dmy"
  | "compact"
  | "month_day_year"
  | "day_month_year"
  | "weekday_short"
  | "weekday_long"
  | "chinese"
  | "xiyuan_zh"
  | "gongyuan_zh"
  | "roc"
  | "minguo_zh"
  | "buddhist_thai"
  | "hebrew"
  | "islamic"
  | "persian"
  | "indian"
  | "chinese_lunar"
  | "japanese";
export type TimeFormat =
  | "locale"
  | "twenty_four"
  | "twelve_hour"
  | "chinese_day_period"
  | "japanese_day_period"
  | "korean_day_period"
  | "thai_day_period"
  | "arabic_day_period";
export type DateTimeFormat = DateFormat;

export const DATE_FORMATS: DateFormat[] = [
  "locale",
  "locale_short",
  "locale_long",
  "locale_full",
  "iso",
  "slash_ymd",
  "dot_ymd",
  "slash_mdy",
  "slash_dmy",
  "dot_dmy",
  "compact",
  "month_day_year",
  "day_month_year",
  "weekday_short",
  "weekday_long",
  "chinese",
  "xiyuan_zh",
  "gongyuan_zh",
  "roc",
  "minguo_zh",
  "buddhist_thai",
  "hebrew",
  "islamic",
  "persian",
  "indian",
  "chinese_lunar",
  "japanese",
];
export const TIME_FORMATS: TimeFormat[] = [
  "locale",
  "twenty_four",
  "twelve_hour",
  "chinese_day_period",
  "japanese_day_period",
  "korean_day_period",
  "thai_day_period",
  "arabic_day_period",
];

export const DEFAULT_DATE_FORMAT: DateFormat = "locale";
export const DEFAULT_TIME_FORMAT: TimeFormat = "locale";
export const DEFAULT_DATE_TIME_FORMAT: DateTimeFormat = DEFAULT_DATE_FORMAT;

let activeDateFormat: DateFormat = DEFAULT_DATE_FORMAT;
let activeTimeFormat: TimeFormat = DEFAULT_TIME_FORMAT;

/** Update the globally active date display format (mirrored from settings). */
export function setDateFormat(fmt: DateFormat): void {
  activeDateFormat = fmt;
}

/** The currently active date display format preset. */
export function currentDateFormat(): DateFormat {
  return activeDateFormat;
}

/** Update the globally active time display format (mirrored from settings). */
export function setTimeFormat(fmt: TimeFormat): void {
  activeTimeFormat = fmt;
}

/** The currently active time display format preset. */
export function currentTimeFormat(): TimeFormat {
  return activeTimeFormat;
}

/** Normalize a stored/wire date format value to a supported preset. */
export function normalizeDateFormat(raw: string | undefined): DateFormat {
  if (raw && (DATE_FORMATS as readonly string[]).includes(raw)) return raw as DateFormat;
  return DEFAULT_DATE_FORMAT;
}

/** Normalize a stored/wire time format value to a supported preset. */
export function normalizeTimeFormat(raw: string | undefined): TimeFormat {
  if (raw && (TIME_FORMATS as readonly string[]).includes(raw)) return raw as TimeFormat;
  return DEFAULT_TIME_FORMAT;
}

/** Normalize a stored/wire date-time format value to a supported legacy preset. */
export const normalizeDateTimeFormat = normalizeDateFormat;

function dateFromValue(value: string | number | Date | undefined | null): Date | null {
  if (value == null || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** YYYY-MM-DD in the date's local calendar. */
function formatLocalYmd(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** HH:MM:SS in the date's local clock. */
function formatLocalHms(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function formatChineseYmd(yearLabel: string, d: Date): string {
  return `${yearLabel}年${d.getMonth() + 1}月${d.getDate()}日`;
}

/** Comparable `date[Ttime]` key; a missing time is start-of-day. Undefined when date is missing. */
export function dateTimeKey(date?: string, time?: string): string | undefined {
  return date ? `${date}T${time || "00:00"}` : undefined;
}

/** Earliest of two optional date+time pairs, using `dateTimeKey` comparison. */
export function earliestDateTimeKey(
  aDate?: string,
  aTime?: string,
  bDate?: string,
  bTime?: string,
): string | undefined {
  const a = dateTimeKey(aDate, aTime);
  const b = dateTimeKey(bDate, bTime);
  if (a && b) return a < b ? a : b;
  return a ?? b;
}

/** `YYYY-MM-DDTHH:MM:SS` in local time for a `datetime-local` input. */
export function formatDatetimeLocalValue(ms: number): string {
  const d = new Date(ms);
  return `${formatLocalYmd(d)}T${formatLocalHms(d)}`;
}

/** Format a date value according to the chosen preset. Returns an em dash for missing/invalid input. */
export function formatDate(
  value: string | number | Date | undefined | null,
  format: DateFormat,
  locale = "en",
): string {
  const d = dateFromValue(value);
  if (!d) return "—";
  const y = d.getFullYear();
  const m = pad2(d.getMonth() + 1);
  const day = pad2(d.getDate());
  switch (format) {
    case "locale_short":
      return d.toLocaleDateString(locale, { dateStyle: "short" });
    case "locale_long":
      return d.toLocaleDateString(locale, { dateStyle: "long" });
    case "locale_full":
      return d.toLocaleDateString(locale, { dateStyle: "full" });
    case "iso":
      return formatLocalYmd(d);
    case "slash_ymd":
      return `${y}/${m}/${day}`;
    case "dot_ymd":
      return `${y}.${m}.${day}`;
    case "slash_mdy":
      return `${m}/${day}/${y}`;
    case "slash_dmy":
      return `${day}/${m}/${y}`;
    case "dot_dmy":
      return `${day}.${m}.${y}`;
    case "compact":
      return `${y}${m}${day}`;
    case "month_day_year":
      return d.toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" });
    case "day_month_year":
      return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
    case "weekday_short":
      return d.toLocaleDateString(locale, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
    case "weekday_long":
      return d.toLocaleDateString(locale, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
    case "chinese":
      return d.toLocaleDateString("zh-TW", { dateStyle: "long" });
    case "xiyuan_zh":
      return formatChineseYmd(`西元${y}`, d);
    case "gongyuan_zh":
      return formatChineseYmd(`公元${y}`, d);
    case "roc":
      return d.toLocaleDateString("zh-TW-u-ca-roc", { dateStyle: "long" });
    case "minguo_zh":
      return formatChineseYmd(formatMinguoYear(y), d);
    case "buddhist_thai":
      return d.toLocaleDateString("th-TH-u-ca-buddhist", { dateStyle: "long" });
    case "hebrew":
      return d.toLocaleDateString("he-IL-u-ca-hebrew", { dateStyle: "long" });
    case "islamic":
      return d.toLocaleDateString("ar-SA-u-ca-islamic", { dateStyle: "long" });
    case "persian":
      return d.toLocaleDateString("fa-IR-u-ca-persian", { dateStyle: "long" });
    case "indian":
      return d.toLocaleDateString("hi-IN-u-ca-indian", { dateStyle: "long" });
    case "chinese_lunar":
      return d.toLocaleDateString("zh-TW-u-ca-chinese", { dateStyle: "long" });
    case "japanese":
      return d.toLocaleDateString("ja-JP-u-ca-japanese", { dateStyle: "long" });
    case "locale":
    default:
      return d.toLocaleDateString(locale, { dateStyle: "medium" });
  }
}

function formatMinguoYear(gregorianYear: number): string {
  const year = gregorianYear - 1911;
  return year > 0 ? `民國${year}` : `民國前${Math.abs(year) + 1}`;
}

const DAY_PERIOD_LOCALES = {
  chinese_day_period: "zh-TW",
  japanese_day_period: "ja-JP",
  korean_day_period: "ko-KR",
  thai_day_period: "th-TH",
  arabic_day_period: "ar",
} as const;

function formatHour12(d: Date, locale: string): string {
  return d.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true });
}

/** Format a time value according to the chosen preset. Returns an em dash for missing/invalid input. */
export function formatTime(
  value: string | number | Date | undefined | null,
  format: TimeFormat,
  locale = "en",
): string {
  const d = dateFromValue(value);
  if (!d) return "—";
  switch (format) {
    case "twenty_four":
      return formatLocalHms(d);
    case "twelve_hour":
      return formatHour12(d, locale);
    case "chinese_day_period":
    case "japanese_day_period":
    case "korean_day_period":
    case "thai_day_period":
    case "arabic_day_period":
      return formatHour12(d, DAY_PERIOD_LOCALES[format]);
    case "locale":
    default:
      return d.toLocaleTimeString(locale, { timeStyle: "medium" });
  }
}

/** Format a `HH:MM`/`HH:MM:SS` local time field according to the chosen preset. */
export function formatTimeOfDay(time: string | undefined, format: TimeFormat, locale = "en"): string {
  if (!time) return "";
  const d = new Date(`2000-01-01T${time}`);
  return Number.isNaN(d.getTime()) ? time : formatTime(d, format, locale);
}

/** Format a `YYYY-MM-DD` local date field according to the chosen preset. */
export function formatIsoDate(iso: string | undefined, format: DateFormat, locale = "en"): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return formatDate(new Date(y, m - 1, d), format, locale);
}

/** Format a date/time value according to the chosen presets. Returns an em dash for missing/invalid input. */
export function formatDateTime(
  value: string | number | Date | undefined | null,
  dateFormat: DateFormat,
  timeFormat: TimeFormat = DEFAULT_TIME_FORMAT,
  locale = "en",
): string {
  const d = dateFromValue(value);
  if (!d) return "—";
  return `${formatDate(d, dateFormat, locale)} ${formatTime(d, timeFormat, locale)}`;
}

/**
 * Format a timestamp as full ISO 8601 in the local timezone, with seconds and an
 * explicit offset — e.g. `2026-05-30T16:08:42+09:00`. Accepts an ISO-8601 string
 * in any offset (the stored/wire form is local time with an offset; UTC `Z`
 * strings from older files still parse) or a raw epoch-ms number. Returns an em
 * dash for a missing/empty/zero timestamp (e.g. a document not yet edited).
 */
export function formatIsoLocal(ts: string | number | undefined | null): string {
  if (!ts) return "—";
  const d = new Date(ts);
  const offMin = -d.getTimezoneOffset(); // minutes east of UTC
  const sign = offMin >= 0 ? "+" : "-";
  const offH = pad2(Math.floor(Math.abs(offMin) / 60));
  const offM = pad2(Math.abs(offMin) % 60);
  return `${formatLocalYmd(d)}T${formatLocalHms(d)}${sign}${offH}:${offM}`;
}

/**
 * A space-frugal local timestamp for the "last synced" indicator. Drops the
 * seconds and offset that `formatIsoLocal` keeps, and elides the parts that match
 * `now`: same calendar day → `HH:MM`; same year → `MM-DD HH:MM`; otherwise the
 * full `YYYY-MM-DD HH:MM`. The precise value still lives in the element's tooltip.
 * Returns an em dash for a missing/empty/zero timestamp.
 */
export function formatIsoLocalShort(
  ts: string | number | undefined | null,
  now: Date = new Date(),
): string {
  if (!ts) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "—";
  const hm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  const md = `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  if (d.getFullYear() !== now.getFullYear()) return `${d.getFullYear()}-${md} ${hm}`;
  const sameDay = d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  return sameDay ? hm : `${md} ${hm}`;
}

/**
 * YYYY-MM-DD of the current logical day in local time. `dayStartHour` (0–23, the
 * user's configured day-start) shifts when the day rolls over: with hour 4, the
 * stretch from 00:00 to 03:59 still counts as the previous calendar day, so the
 * Today view rotates at 4am instead of midnight. The default (0) is plain
 * midnight rollover, identical to a normal calendar date.
 */
export function todayIso(now: Date = new Date(), dayStartHour = 0): string {
  const at = dayStartHour ? new Date(now.getTime() - dayStartHour * MS_PER_HOUR) : now;
  return formatLocalYmd(at);
}

/**
 * The logical day (YYYY-MM-DD) a stored local-offset timestamp belongs to, honoring
 * `dayStartHour`. Reads the wall-clock date and hour written in the string itself
 * (not the runner's timezone), so it stays consistent with how `completed_at` /
 * `created_at` are stamped and is independent of where the code runs. A wall-clock
 * hour before the day-start counts as the previous calendar day — the same shift
 * `todayIso` applies — so a completion at 00:05 with a 3am start stays on "today"
 * until the rollover. With the default hour (0) this is a plain date slice.
 */
export function logicalDayOf(localIso: string, dayStartHour = 0): string {
  const date = localIso.slice(0, 10);
  if (!dayStartHour || !date) return date;
  const hour = Number(localIso.slice(11, 13));
  return hour < dayStartHour ? addDaysIso(date, -1) : date;
}

/** Compare two ISO date strings lexically — works because format is fixed-width. */
export function isoLt(a: string, b: string): boolean { return a < b; }

/** ISO date (YYYY-MM-DD) `days` after `baseIso`, computed in UTC to avoid DST drift. */
export function addDaysIso(baseIso: string, days: number): string {
  const [y, m, d] = baseIso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

/** Whole days from `fromIso` to `toIso` (negative when `toIso` is earlier). */
export function daysBetweenIso(fromIso: string, toIso: string): number {
  const utc = (s: string) => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((utc(toIso) - utc(fromIso)) / MS_PER_DAY);
}

/** True if a task with this due date is overdue relative to today. */
export function isOverdue(dueIso: string | undefined, todayIsoStr: string, done: boolean): boolean {
  if (done || !dueIso) return false;
  return isoLt(dueIso, todayIsoStr);
}
