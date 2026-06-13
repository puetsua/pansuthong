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
export const DATE_TIME_FORMATS: DateTimeFormat[] = DATE_FORMATS;

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

/** Legacy helper: update the date half of the display format. */
export function setDateTimeFormat(fmt: DateTimeFormat): void {
  setDateFormat(fmt);
}

/** Legacy helper: the currently active date half of the display format. */
export function currentDateTimeFormat(): DateTimeFormat {
  return currentDateFormat();
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
      return formatIsoDateParts(d);
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
      return `西元${y}年${d.getMonth() + 1}月${d.getDate()}日`;
    case "gongyuan_zh":
      return `公元${y}年${d.getMonth() + 1}月${d.getDate()}日`;
    case "roc":
      return d.toLocaleDateString("zh-TW-u-ca-roc", { dateStyle: "long" });
    case "minguo_zh":
      return `${formatMinguoYear(y)}年${d.getMonth() + 1}月${d.getDate()}日`;
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
      return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
    case "twelve_hour":
      return d.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true });
    case "chinese_day_period":
      return d.toLocaleTimeString("zh-TW", { hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true });
    case "japanese_day_period":
      return d.toLocaleTimeString("ja-JP", { hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true });
    case "korean_day_period":
      return d.toLocaleTimeString("ko-KR", { hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true });
    case "thai_day_period":
      return d.toLocaleTimeString("th-TH", { hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true });
    case "arabic_day_period":
      return d.toLocaleTimeString("ar", { hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true });
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
  timeFormatOrLocale: TimeFormat | string = DEFAULT_TIME_FORMAT,
  locale = "en",
): string {
  const d = dateFromValue(value);
  if (!d) return "—";
  const timeFormat = (TIME_FORMATS as readonly string[]).includes(timeFormatOrLocale)
    ? timeFormatOrLocale as TimeFormat
    : DEFAULT_TIME_FORMAT;
  const effectiveLocale = (TIME_FORMATS as readonly string[]).includes(timeFormatOrLocale)
    ? locale
    : timeFormatOrLocale;
  return `${formatDate(d, dateFormat, effectiveLocale)} ${formatTime(d, timeFormat, effectiveLocale)}`;
}

function formatIsoDateParts(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
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
  const pad = (n: number) => String(n).padStart(2, "0");
  const offMin = -d.getTimezoneOffset(); // minutes east of UTC
  const sign = offMin >= 0 ? "+" : "-";
  const offH = pad(Math.floor(Math.abs(offMin) / 60));
  const offM = pad(Math.abs(offMin) % 60);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${offH}:${offM}`
  );
}

/**
 * YYYY-MM-DD of the current logical day in local time. `dayStartHour` (0–23, the
 * user's configured day-start) shifts when the day rolls over: with hour 4, the
 * stretch from 00:00 to 03:59 still counts as the previous calendar day, so the
 * Today view rotates at 4am instead of midnight. The default (0) is plain
 * midnight rollover, identical to a normal calendar date.
 */
export function todayIso(now: Date = new Date(), dayStartHour = 0): string {
  const at = dayStartHour ? new Date(now.getTime() - dayStartHour * 3_600_000) : now;
  const y = at.getFullYear();
  const m = String(at.getMonth() + 1).padStart(2, "0");
  const d = String(at.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
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
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/** Whole days from `fromIso` to `toIso` (negative when `toIso` is earlier). */
export function daysBetweenIso(fromIso: string, toIso: string): number {
  const utc = (s: string) => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((utc(toIso) - utc(fromIso)) / 86_400_000);
}

/** True if a task with this due date is overdue relative to today. */
export function isOverdue(dueIso: string | undefined, todayIsoStr: string, done: boolean): boolean {
  if (done || !dueIso) return false;
  return isoLt(dueIso, todayIsoStr);
}
