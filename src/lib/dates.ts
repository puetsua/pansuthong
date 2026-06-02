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
