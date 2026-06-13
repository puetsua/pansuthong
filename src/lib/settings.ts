import { Settings } from "./tauri";
import { clampWeight } from "./tags";

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

/** Default minutes between repeat notifications once a task exceeds its estimate. */
export const REMINDER_INTERVAL_DEFAULT = 10;
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
