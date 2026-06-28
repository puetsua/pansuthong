import { Settings } from "./tauri";
import { clampWeight } from "./tags";
import {
  DateFormat,
  DateTimeFormat,
  DEFAULT_DATE_FORMAT,
  DEFAULT_DATE_TIME_FORMAT,
  DEFAULT_TIME_FORMAT,
  normalizeDateFormat,
  normalizeDateTimeFormat,
  normalizeTimeFormat,
  TimeFormat,
} from "./dates";

/** Default Upcoming horizon (days ahead) when a document doesn't specify one. */
export const UPCOMING_DAYS_DEFAULT = 14;
/** Inclusive bounds for the configurable Upcoming horizon (mirrors the Rust check). */
export const UPCOMING_DAYS_MIN = 1;
export const UPCOMING_DAYS_MAX = 365;

/** The effective Upcoming horizon for a document's settings (default when unset). */
export function upcomingDays(settings: Settings): number {
  return clampUpcomingDays(settings.upcoming_days ?? UPCOMING_DAYS_DEFAULT);
}

/** Parse a free-typed day count to an integer clamped to the allowed range. */
export function clampUpcomingDays(raw: string | number): number {
  const n = typeof raw === "number" ? Math.trunc(raw) : parseInt(raw, 10);
  if (Number.isNaN(n)) return UPCOMING_DAYS_DEFAULT;
  return Math.max(UPCOMING_DAYS_MIN, Math.min(UPCOMING_DAYS_MAX, n));
}

/** Default hour the logical day rolls over at (0 = midnight, current behavior). */
export const DAY_START_HOUR_DEFAULT = 0;
/** Inclusive bounds for the configurable day-start hour (mirrors the Rust check). */
export const DAY_START_HOUR_MIN = 0;
export const DAY_START_HOUR_MAX = 23;

/** The hour (0–23) at which "today" rolls over for this document (default midnight). */
export function dayStartHour(settings: Settings): number {
  return clampDayStartHour(settings.day_start_hour ?? DAY_START_HOUR_DEFAULT);
}

/** Parse a free-typed hour to an integer clamped to 0..23. */
export function clampDayStartHour(raw: string | number): number {
  const n = typeof raw === "number" ? Math.trunc(raw) : parseInt(raw, 10);
  if (Number.isNaN(n)) return DAY_START_HOUR_DEFAULT;
  return Math.max(DAY_START_HOUR_MIN, Math.min(DAY_START_HOUR_MAX, n));
}

/** Color a new tag starts with when the user hasn't set a preference (#79). */
export const DEFAULT_TAG_COLOR = "#475569";
/** Priority weight a new tag starts with when unset (#79). */
export const DEFAULT_TAG_PRIORITY = 0;

/** The color a new tag's swatch should pre-fill to for these settings. */
export function defaultTagColor(settings?: Settings): string {
  return settings?.default_tag_color ?? DEFAULT_TAG_COLOR;
}

/** The weight a new tag should pre-fill to, clamped defensively to the valid range. */
export function defaultTagPriority(settings?: Settings): number {
  const p = settings?.default_tag_priority;
  return p === undefined ? DEFAULT_TAG_PRIORITY : clampWeight(String(p));
}

/** Whether the task-completion chime is enabled (#80). Absent = on (the default). */
export function soundOnComplete(settings: Settings): boolean {
  return settings.sound_on_complete ?? true;
}

/** The active date-time display format preset (default "locale"). */
export function dateTimeFormat(settings?: Settings): DateTimeFormat {
  return normalizeDateTimeFormat(settings?.date_time_format);
}

/** The active date display format preset (default "locale"). */
export function dateFormat(settings?: Settings): DateFormat {
  return normalizeDateFormat(settings?.date_format ?? settings?.date_time_format);
}

/** The active time display format preset (default "locale"). */
export function timeFormat(settings?: Settings): TimeFormat {
  return normalizeTimeFormat(settings?.time_format);
}

/** Default date-time display preset. */
export { DEFAULT_DATE_TIME_FORMAT as DATE_TIME_FORMAT_DEFAULT };
export { DEFAULT_DATE_FORMAT as DATE_FORMAT_DEFAULT, DEFAULT_TIME_FORMAT as TIME_FORMAT_DEFAULT };

/** Default minutes between repeat notifications once a task exceeds its estimate. */
export const REMINDER_INTERVAL_DEFAULT = 1;
/** Inclusive bounds for the configurable reminder interval (mirrors the Rust check). */
export const REMINDER_INTERVAL_MIN = 1;
export const REMINDER_INTERVAL_MAX = 1440;

/** The effective re-notify interval (minutes) for a document's settings (default when unset). */
export function reminderIntervalMinutes(settings: Settings): number {
  return clampReminderInterval(settings.reminder_interval_minutes ?? REMINDER_INTERVAL_DEFAULT);
}

/** Parse a free-typed minute count to an integer clamped to the allowed range. */
export function clampReminderInterval(raw: string | number): number {
  const n = typeof raw === "number" ? Math.trunc(raw) : parseInt(raw, 10);
  if (Number.isNaN(n)) return REMINDER_INTERVAL_DEFAULT;
  return Math.max(REMINDER_INTERVAL_MIN, Math.min(REMINDER_INTERVAL_MAX, n));
}

/** Default largest attachment size (MiB) when a document doesn't specify one. */
export const MAX_ATTACHMENT_MB_DEFAULT = 1024;
/** Inclusive bounds for the configurable attachment cap (mirrors the Rust check). */
export const MAX_ATTACHMENT_MB_MIN = 1;
export const MAX_ATTACHMENT_MB_MAX = 10240;
/** Above this, the UI warns that large attachments may slow the program. */
export const MAX_ATTACHMENT_MB_WARN = 100;

/** The effective attachment size cap (MiB) for a document's settings. */
export function maxAttachmentMb(settings: Settings): number {
  return clampMaxAttachmentMb(settings.max_attachment_mb ?? MAX_ATTACHMENT_MB_DEFAULT);
}

/** Parse a free-typed MiB count to an integer clamped to the allowed range. */
export function clampMaxAttachmentMb(raw: string | number): number {
  const n = typeof raw === "number" ? Math.trunc(raw) : parseInt(raw, 10);
  if (Number.isNaN(n)) return MAX_ATTACHMENT_MB_DEFAULT;
  return Math.max(MAX_ATTACHMENT_MB_MIN, Math.min(MAX_ATTACHMENT_MB_MAX, n));
}

/** Default Recurrence dashboard heatmap range (days back from today). */
export const RECURRENCE_HEATMAP_DAYS_DEFAULT = 90;
/** Inclusive bounds for the heatmap range (mirrors the Rust check). */
export const RECURRENCE_HEATMAP_DAYS_MIN = 7;
export const RECURRENCE_HEATMAP_DAYS_MAX = 365;

/** The effective heatmap range (days back from today) for a document's settings. */
export function recurrenceHeatmapDays(settings: Settings): number {
  return clampRecurrenceHeatmapDays(settings.recurrence_heatmap_days ?? RECURRENCE_HEATMAP_DAYS_DEFAULT);
}

/** Parse a free-typed day count to an integer clamped to the allowed range. */
export function clampRecurrenceHeatmapDays(raw: string | number): number {
  const n = typeof raw === "number" ? Math.trunc(raw) : parseInt(raw, 10);
  if (Number.isNaN(n)) return RECURRENCE_HEATMAP_DAYS_DEFAULT;
  return Math.max(RECURRENCE_HEATMAP_DAYS_MIN, Math.min(RECURRENCE_HEATMAP_DAYS_MAX, n));
}

/** Default first day of the week for the heatmap (1 = Monday, the prior behavior). */
export const FIRST_DAY_OF_WEEK_DEFAULT = 1;
/** Inclusive bounds: 0 = Sunday .. 6 = Saturday (JS `getDay`; mirrors the Rust check). */
export const FIRST_DAY_OF_WEEK_MIN = 0;
export const FIRST_DAY_OF_WEEK_MAX = 6;

/** The heatmap's first-day-of-week weekday (0=Sun..6=Sat) for these settings. */
export function firstDayOfWeek(settings: Settings): number {
  return clampFirstDayOfWeek(settings.first_day_of_week ?? FIRST_DAY_OF_WEEK_DEFAULT);
}

/** Parse a free-typed weekday index to an integer clamped to 0..6. */
export function clampFirstDayOfWeek(raw: string | number): number {
  const n = typeof raw === "number" ? Math.trunc(raw) : parseInt(raw, 10);
  if (Number.isNaN(n)) return FIRST_DAY_OF_WEEK_DEFAULT;
  return Math.max(FIRST_DAY_OF_WEEK_MIN, Math.min(FIRST_DAY_OF_WEEK_MAX, n));
}
