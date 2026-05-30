/**
 * Format an epoch-ms timestamp as full ISO 8601 in the local timezone, with
 * seconds and an explicit offset — e.g. `2026-05-30T16:08:42+09:00`. Returns an
 * em dash for a missing/zero timestamp (e.g. a document not yet edited).
 */
export function formatIsoLocal(epochMs: number | undefined | null): string {
  if (!epochMs) return "—";
  const d = new Date(epochMs);
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

/** YYYY-MM-DD in local time. */
export function todayIso(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Compare two ISO date strings lexically — works because format is fixed-width. */
export function isoLt(a: string, b: string): boolean { return a < b; }

/** True if a task with this due date is overdue relative to today. */
export function isOverdue(dueIso: string | undefined, todayIsoStr: string, done: boolean): boolean {
  if (done || !dueIso) return false;
  return isoLt(dueIso, todayIsoStr);
}
