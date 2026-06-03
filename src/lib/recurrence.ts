import { Recurrence } from "./tauri";

/** A computed, never-persisted recurrence occurrence shown as a row (#9). */
export type GhostTask = {
  id: string;             // `ghost_<templateId>_<iso>` — stable per occurrence
  title: string;
  tag_ids: string[];      // copied from the template; drives tag membership + priority
  templateId: string;
  occurrenceDate: string; // YYYY-MM-DD
};

/** Parse a YYYY-MM-DD string into a UTC Date (avoids local-tz/DST drift). */
function utcDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** ISO weekday for a date string: Monday=1 .. Sunday=7. */
export function isoWeekday(iso: string): number {
  const js = utcDate(iso).getUTCDay(); // 0=Sun..6=Sat
  return js === 0 ? 7 : js;
}

/** Number of days in the month of the given date string. */
export function daysInMonth(iso: string): number {
  const [y, m] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate(); // day 0 of next month = last of this
}

/** Whether a recurrence rule fires on the given date (YYYY-MM-DD). */
export function occursOn(rec: Recurrence, iso: string): boolean {
  if (rec.kind === "weekly") return rec.weekdays.includes(isoWeekday(iso));
  const dom = Number(iso.slice(8, 10));
  return dom === Math.min(rec.day, daysInMonth(iso));
}
