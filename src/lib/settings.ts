import { Settings } from "./tauri";

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
