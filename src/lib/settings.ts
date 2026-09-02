import { Settings } from "./tauri";
import { clampWeight } from "./tags";
import { activeVariant, prefersDarkScheme, resolveThemeVars } from "./themes";
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

function clampInt(raw: string | number, min: number, max: number, fallback: number): number {
  const n = typeof raw === "number" ? Math.trunc(raw) : parseInt(raw, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

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
  return clampInt(raw, UPCOMING_DAYS_MIN, UPCOMING_DAYS_MAX, UPCOMING_DAYS_DEFAULT);
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
  return clampInt(raw, DAY_START_HOUR_MIN, DAY_START_HOUR_MAX, DAY_START_HOUR_DEFAULT);
}

/** Built-in light background (`--c-bg`); fallback when theme tokens are unavailable. */
export const DEFAULT_TAG_COLOR = "#f9fafb";
/** Theme token used as the new-tag color (page background of the active variant). */
export const NEW_TAG_COLOR_TOKEN = "--c-bg";
/** Priority weight a new tag starts with when unset (#79). */
export const DEFAULT_TAG_PRIORITY = 0;

/** Expand `#rgb`/`#rrggbb` to lowercase `#rrggbb`, or undefined if not a hex color. */
export function normalizeTagColorHex(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const s = raw.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  if (/^#[0-9a-f]{3}$/.test(s)) return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  return undefined;
}

function cssThemeTagColor(): string | undefined {
  if (typeof document === "undefined") return undefined;
  try {
    return normalizeTagColorHex(
      getComputedStyle(document.documentElement).getPropertyValue(NEW_TAG_COLOR_TOKEN),
    );
  } catch {
    return undefined;
  }
}

/**
 * Color a new tag starts with: the active theme's `--c-bg`.
 * `settings.default_tag_color` is kept on config.json for compatibility and is not used.
 */
export function defaultTagColor(settings?: Settings): string {
  if (settings) {
    const variant = activeVariant(settings.theme ?? "auto", prefersDarkScheme());
    const fromTheme = normalizeTagColorHex(resolveThemeVars(settings, variant)[NEW_TAG_COLOR_TOKEN]);
    if (fromTheme) return fromTheme;
  }
  return cssThemeTagColor() ?? DEFAULT_TAG_COLOR;
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
  return clampInt(raw, REMINDER_INTERVAL_MIN, REMINDER_INTERVAL_MAX, REMINDER_INTERVAL_DEFAULT);
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
  return clampInt(raw, MAX_ATTACHMENT_MB_MIN, MAX_ATTACHMENT_MB_MAX, MAX_ATTACHMENT_MB_DEFAULT);
}

/** Default Dashboard heatmap range (days back from today). */
export const DASHBOARD_HEATMAP_DAYS_DEFAULT = 90;
/** Inclusive bounds for the heatmap range (mirrors the Rust check). */
export const DASHBOARD_HEATMAP_DAYS_MIN = 7;
export const DASHBOARD_HEATMAP_DAYS_MAX = 365;

/** The effective Dashboard/Tag heatmap range (days back from today). */
export function dashboardHeatmapDays(settings: Settings): number {
  // Persisted key stays `recurrence_heatmap_days` for backward compatibility.
  return clampDashboardHeatmapDays(settings.recurrence_heatmap_days ?? DASHBOARD_HEATMAP_DAYS_DEFAULT);
}

/** Parse a free-typed day count to an integer clamped to the allowed range. */
export function clampDashboardHeatmapDays(raw: string | number): number {
  return clampInt(raw, DASHBOARD_HEATMAP_DAYS_MIN, DASHBOARD_HEATMAP_DAYS_MAX, DASHBOARD_HEATMAP_DAYS_DEFAULT);
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
  return clampInt(raw, FIRST_DAY_OF_WEEK_MIN, FIRST_DAY_OF_WEEK_MAX, FIRST_DAY_OF_WEEK_DEFAULT);
}
