import { Task, TimeEntry } from "./tauri";

/** The running time entry (the open interval with no `end`), if any (#81). */
export function runningEntry(task: Task): TimeEntry | undefined {
  return task.time_entries?.find(e => e.end == null);
}

/** Whether a timer is currently running on this task. */
export function isTiming(task: Task): boolean {
  return runningEntry(task) !== undefined;
}

/** Tasks across the document that currently have a running timer (#idle-timer).
 *  The app allows concurrent timers, so this can hold more than one. */
export function timingTasks(tasks: Task[]): Task[] {
  return tasks.filter(isTiming);
}

/** Epoch-ms of the most recent *finished* interval end across all tasks, or null
 *  when no time has ever been tracked. Open and unparseable entries are skipped —
 *  a running timer is "now", not a past activity boundary (#idle-timer). */
export function lastActivityMs(tasks: Task[]): number | null {
  let last: number | null = null;
  for (const t of tasks) {
    for (const e of t.time_entries ?? []) {
      if (e.end == null) continue;
      const end = Date.parse(e.end);
      if (Number.isNaN(end)) continue;
      if (last == null || end > last) last = end;
    }
  }
  return last;
}

/**
 * What the Today-style idle indicator should show right now (#idle-timer):
 *   - "running": at least one timer is going; report how many and the longest
 *     running task's live elapsed (the running entry that started earliest).
 *   - "idle": nothing is running; count up from `sinceMs` ago, where the anchor
 *     is the later of the last finished activity and this app session's start.
 *     Anchoring to `sessionStartMs` makes the idle clock reset on app close/reopen
 *     (the frontend reloads, capturing a fresh start) while still growing without
 *     bound within a single session, which is the intended behavior.
 */
export type TrackingStatus =
  | { kind: "running"; count: number; longestMs: number }
  | { kind: "idle"; sinceMs: number };

export function trackingStatus(tasks: Task[], nowMs: number, sessionStartMs: number): TrackingStatus {
  const running = timingTasks(tasks);
  if (running.length > 0) {
    const longestMs = running.reduce((max, t) => Math.max(max, elapsedMs(t, nowMs)), 0);
    return { kind: "running", count: running.length, longestMs };
  }
  const last = lastActivityMs(tasks);
  const anchor = last != null ? Math.max(last, sessionStartMs) : sessionStartMs;
  return { kind: "idle", sinceMs: Math.max(0, nowMs - anchor) };
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

/** Idle spans falling within this gap of an existing entry on the target task are
 *  concatenated into it rather than added as a separate session (#idle-timer). The
 *  common case: the idle span starts exactly where the last entry ended, so
 *  assigning it back extends that entry instead of leaving a one-second seam. */
export const IDLE_MERGE_GAP_MS = 60_000;

/**
 * The closed entry on the task nearest to (and within `gapMs` of, or overlapping)
 * the candidate `[startMs, endMs]`, suitable for concatenation — or undefined when
 * none is close enough. Open entries are never merge targets (#idle-timer).
 */
export function mergeableEntry(
  entries: TimeEntry[] | undefined,
  startMs: number,
  endMs: number,
  gapMs: number,
): TimeEntry | undefined {
  let best: TimeEntry | undefined;
  let bestGap = Number.POSITIVE_INFINITY;
  for (const e of entries ?? []) {
    if (e.end == null) continue;
    const s = Date.parse(e.start), en = Date.parse(e.end);
    if (Number.isNaN(s) || Number.isNaN(en)) continue;
    // A non-positive gap means the ranges overlap or touch; clamp it to 0 so any
    // overlap is treated as the closest possible match.
    const dist = Math.max(0, startMs - en, s - endMs);
    if (dist <= gapMs && dist < bestGap) { best = e; bestGap = dist; }
  }
  return best;
}

/**
 * Whether the half-open interval `[startMs, endMs)` overlaps any of `entries`,
 * skipping the entry whose id is `exceptId` (the one being edited). A `null`/open
 * end (a running timer) extends to `+∞`. Touching at an endpoint isn't an overlap,
 * so back-to-back sessions are allowed. Mirrors the Rust `time_entry_overlaps`
 * guard so the editor catches a clash before the command rejects it (#81).
 */
export function overlapsExisting(
  entries: TimeEntry[] | undefined,
  startMs: number,
  endMs: number | null,
  exceptId?: string,
): boolean {
  const aEnd = endMs ?? Number.POSITIVE_INFINITY;
  return (entries ?? []).some(e => {
    if (e.id === exceptId) return false;
    const bStart = Date.parse(e.start);
    const bEnd = e.end != null ? Date.parse(e.end) : Number.POSITIVE_INFINITY;
    return startMs < bEnd && bStart < aEnd;
  });
}
