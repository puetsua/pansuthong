import { Task, isDone } from "./tauri";

export type ArrivalKind = "start" | "due";

export type TaskArrival = {
  task: Task;
  kind: ArrivalKind;
  /** Local instant when the notification should fire. */
  at: Date;
  /** Stable dedupe key for this task/kind/moment. */
  key: string;
};

/** How far ahead to register OS-scheduled notifications. */
export const SCHEDULE_HORIZON_MS = 7 * 24 * 60 * 60 * 1000;
/** Poll interval while the app is running. */
export const POLL_MS = 60_000;
/** After this window a missed arrival is too stale to notify on resume. */
export const MISSED_GRACE_MS = 60 * 60 * 1000;

const STORAGE_KEY = "pansuthong.scheduledArrivalNotified";

/** Which schedule field drives the arrival notification. */
export function taskArrivalKind(task: Task): ArrivalKind | null {
  if (isDone(task)) return null;
  if (task.start_date) return "start";
  if (task.due_date) return "due";
  return null;
}

/** Local arrival instant; undefined when the task has no schedulable date. */
export function taskArrivalMoment(task: Task, dayStartHour: number): Date | undefined {
  const kind = taskArrivalKind(task);
  if (!kind) return undefined;

  const date = kind === "start" ? task.start_date : task.due_date;
  if (!date) return undefined;

  const time = kind === "start" ? task.start_time : task.due_time;
  const [year, month, day] = date.split("-").map(Number);
  if (!year || !month || !day) return undefined;

  let hour = dayStartHour;
  let minute = 0;
  if (time) {
    const [h, m] = time.split(":").map(Number);
    if (Number.isFinite(h) && Number.isFinite(m)) {
      hour = h;
      minute = m;
    }
  }

  const at = new Date(year, month - 1, day, hour, minute, 0, 0);
  return Number.isNaN(at.getTime()) ? undefined : at;
}

/** Dedupe key: kind + task id + local date/time parts. */
export function arrivalKey(kind: ArrivalKind, taskId: string, at: Date): string {
  const y = at.getFullYear();
  const mo = String(at.getMonth() + 1).padStart(2, "0");
  const d = String(at.getDate()).padStart(2, "0");
  const h = String(at.getHours()).padStart(2, "0");
  const mi = String(at.getMinutes()).padStart(2, "0");
  return `${kind}:${taskId}:${y}-${mo}-${d}:${h}:${mi}`;
}

/** Build arrival metadata for a task when it has a schedulable moment. */
export function taskArrival(task: Task, dayStartHour: number): TaskArrival | undefined {
  const kind = taskArrivalKind(task);
  const at = taskArrivalMoment(task, dayStartHour);
  if (!kind || !at) return undefined;
  return { task, kind, at, key: arrivalKey(kind, task.id, at) };
}

/** True when `now` is on or after the arrival and still inside the missed grace window. */
export function isArrivalDue(at: Date, now: number, graceMs = MISSED_GRACE_MS): boolean {
  const arrivalMs = at.getTime();
  return now >= arrivalMs && now - arrivalMs <= graceMs;
}

/** Arrivals that should notify immediately at `now`. */
export function arrivalsDueNow(
  tasks: Task[],
  now: number,
  dayStartHour: number,
  notified: ReadonlySet<string>,
): TaskArrival[] {
  const out: TaskArrival[] = [];
  for (const task of tasks) {
    const arrival = taskArrival(task, dayStartHour);
    if (!arrival || notified.has(arrival.key)) continue;
    if (isArrivalDue(arrival.at, now)) out.push(arrival);
  }
  return out;
}

/** Future arrivals within the OS scheduling horizon (not yet due). */
export function upcomingArrivals(
  tasks: Task[],
  now: number,
  dayStartHour: number,
  horizonMs = SCHEDULE_HORIZON_MS,
): TaskArrival[] {
  const out: TaskArrival[] = [];
  const end = now + horizonMs;
  for (const task of tasks) {
    const arrival = taskArrival(task, dayStartHour);
    if (!arrival) continue;
    const ms = arrival.at.getTime();
    if (ms > now && ms <= end) out.push(arrival);
  }
  return out;
}

/** 32-bit signed notification id for the Tauri plugin (cancel/reschedule). */
export function notificationId(kind: ArrivalKind, taskId: string): number {
  const input = `${kind}:${taskId}`;
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0;
  }
  return hash === 0 ? 1 : hash;
}

export function loadNotifiedKeys(): Set<string> {
  if (typeof localStorage === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((k): k is string => typeof k === "string"));
  } catch {
    return new Set();
  }
}

export function saveNotifiedKeys(keys: ReadonlySet<string>): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...keys]));
  } catch {
    // Quota or private mode — in-memory dedupe still applies this session.
  }
}

export function markNotified(keys: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(keys);
  next.add(key);
  saveNotifiedKeys(next);
  return next;
}

/** Drop notified keys for tasks that no longer exist (housekeeping). */
export function pruneNotifiedKeys(keys: ReadonlySet<string>, taskIds: ReadonlySet<string>): Set<string> {
  const next = new Set<string>();
  for (const key of keys) {
    const taskId = key.split(":")[1];
    if (taskId && taskIds.has(taskId)) next.add(key);
  }
  if (next.size !== keys.size) saveNotifiedKeys(next);
  return next;
}
