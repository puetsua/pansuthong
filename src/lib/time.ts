import { Task, TimeEntry } from "./tauri";

/** The running time entry (the open interval with no `end`), if any (#81). */
export function runningEntry(task: Task): TimeEntry | undefined {
  return task.time_entries?.find(e => e.end == null);
}

/** Whether a timer is currently running on this task. */
export function isTiming(task: Task): boolean {
  return runningEntry(task) !== undefined;
}

/** Milliseconds covered by one entry, measuring an open one up to `nowMs`. Clamped
 *  to ≥ 0 so a backwards clock (or a bad manual edit) never records negative time. */
function entryMs(entry: TimeEntry, nowMs: number): number {
  const start = Date.parse(entry.start);
  if (Number.isNaN(start)) return 0;
  const end = entry.end != null ? Date.parse(entry.end) : nowMs;
  if (Number.isNaN(end)) return 0;
  return Math.max(0, end - start);
}

/** Total tracked time for a task, counting any running interval up to `nowMs`. */
export function elapsedMs(task: Task, nowMs: number): number {
  return (task.time_entries ?? []).reduce((sum, e) => sum + entryMs(e, nowMs), 0);
}

const pad = (n: number) => String(n).padStart(2, "0");

/** A live clock: `M:SS` under an hour, `H:MM:SS` from an hour up (#81). */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** A compact total for at-a-glance display: `45s`, `1m`, `1h 23m` (#81). */
export function formatDurationShort(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  if (total < 60) return `${total}s`;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
