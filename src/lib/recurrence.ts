import { Recurrence } from "./tauri";

/** A computed, never-persisted recurrence occurrence shown as a row (#9). */
export type GhostTask = {
  id: string;             // `ghost_<templateId>_<iso>` — stable per occurrence
  title: string;
  notes: string;          // copied from the template; for the creating-draft editor (#9)
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
  const dom = Number(iso.slice(8, 10));
  const month = Number(iso.slice(5, 7));
  switch (rec.kind) {
    case "daily":   return true;
    case "weekly":  return rec.weekdays.includes(isoWeekday(iso));
    // Fires if any listed day matches, each clamped to the month's last day.
    case "monthly": return rec.days.some(d => dom === Math.min(d, daysInMonth(iso)));
    // Exact month+day match (no clamp): a Feb-29 date only matches in leap years and
    // is simply absent otherwise (dom can't be 29 in a 28-day Feb).
    case "yearly":  return rec.dates.some(dt => dt.month === month && dt.day === dom);
  }
}
