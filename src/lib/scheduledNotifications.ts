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

/** Payload key stored on scheduled notifications for reconciliation. */
export const ARRIVAL_KEY_EXTRA = "arrivalKey";

/** How far ahead to register OS-scheduled notifications. */
export const SCHEDULE_HORIZON_MS = 7 * 24 * 60 * 60 * 1000;
/** Poll interval while the app is running. */
export const POLL_MS = 60_000;
/** After this window a missed arrival is too stale to notify on resume. */
export const MISSED_GRACE_MS = 60 * 60 * 1000;

const NOTIFIED_STORAGE_KEY = "pansuthong.scheduledArrivalNotified";
const OS_SCHEDULED_STORAGE_KEY = "pansuthong.scheduledArrivalOsScheduled";
const NOTIFICATION_ID_PREFIX = "pansuthong.scheduled.";

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

/** Whether to send an immediate notification now (poll/resume path). */
export function shouldNotifyImmediately(
  arrival: TaskArrival,
  now: number,
  notified: ReadonlySet<string>,
  claimed: ReadonlySet<string>,
  graceMs = MISSED_GRACE_MS,
): boolean {
  if (notified.has(arrival.key) || claimed.has(arrival.key)) return false;
  return isArrivalDue(arrival.at, now, graceMs);
}

/** Arrivals that should notify immediately at `now`. */
export function arrivalsDueNow(
  tasks: Task[],
  now: number,
  dayStartHour: number,
  notified: ReadonlySet<string>,
  claimed: ReadonlySet<string> = new Set(),
): TaskArrival[] {
  const out: TaskArrival[] = [];
  for (const task of tasks) {
    const arrival = taskArrival(task, dayStartHour);
    if (!arrival) continue;
    if (shouldNotifyImmediately(arrival, now, notified, claimed)) out.push(arrival);
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
  const input = `${NOTIFICATION_ID_PREFIX}${kind}.${taskId}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  const signed = hash | 0;
  return signed === 0 ? 1 : signed;
}

/** Notification ids owned by the scheduled-arrival feature for the current tasks. */
export function ownedNotificationIds(tasks: Task[], dayStartHour: number): Set<number> {
  const ids = new Set<number>();
  for (const task of tasks) {
    const arrival = taskArrival(task, dayStartHour);
    if (arrival) ids.add(notificationId(arrival.kind, task.id));
  }
  return ids;
}

/** Stable signature of the OS schedule set; used to skip redundant re-schedules. */
export function scheduleSignature(arrivals: TaskArrival[]): string {
  return arrivals
    .map(a => a.key)
    .sort()
    .join("|");
}

/**
 * After a cold start, treat OS-scheduled arrivals that are no longer pending as
 * delivered so we do not re-notify inside the grace window.
 */
export function reconcileOsDelivered(
  tasks: Task[],
  now: number,
  dayStartHour: number,
  notified: ReadonlySet<string>,
  osScheduled: ReadonlySet<string>,
  pendingIds: ReadonlySet<number>,
): { notified: Set<string>; osScheduled: Set<string> } {
  let nextNotified = new Set(notified);
  let nextOsScheduled = new Set(osScheduled);

  for (const task of tasks) {
    const arrival = taskArrival(task, dayStartHour);
    if (!arrival || !isArrivalDue(arrival.at, now)) continue;
    if (!nextOsScheduled.has(arrival.key)) continue;
    if (pendingIds.has(notificationId(arrival.kind, arrival.task.id))) continue;

    nextNotified = markNotified(nextNotified, arrival.key);
    nextOsScheduled = clearOsScheduled(nextOsScheduled, arrival.key);
  }

  return { notified: nextNotified, osScheduled: nextOsScheduled };
}

/** Owned pending ids that are stale (not in the desired future schedule). */
export function staleOwnedPendingIds(
  ownedIds: ReadonlySet<number>,
  desiredFutureIds: ReadonlySet<number>,
  pendingIds: ReadonlySet<number>,
): number[] {
  const stale: number[] = [];
  for (const id of pendingIds) {
    if (!ownedIds.has(id)) continue;
    if (!desiredFutureIds.has(id)) stale.push(id);
  }
  return stale;
}

export function loadNotifiedKeys(): Set<string> {
  return loadStringSet(NOTIFIED_STORAGE_KEY);
}

export function loadOsScheduledKeys(): Set<string> {
  return loadStringSet(OS_SCHEDULED_STORAGE_KEY);
}

export function saveNotifiedKeys(keys: ReadonlySet<string>): void {
  saveStringSet(NOTIFIED_STORAGE_KEY, keys);
}

export function saveOsScheduledKeys(keys: ReadonlySet<string>): void {
  saveStringSet(OS_SCHEDULED_STORAGE_KEY, keys);
}

export function markNotified(keys: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(keys);
  next.add(key);
  saveNotifiedKeys(next);
  return next;
}

export function markOsScheduled(keys: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(keys);
  next.add(key);
  saveOsScheduledKeys(next);
  return next;
}

export function clearOsScheduled(keys: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(keys);
  next.delete(key);
  saveOsScheduledKeys(next);
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

/** Drop OS-scheduled keys for tasks that no longer exist. */
export function pruneOsScheduledKeys(keys: ReadonlySet<string>, taskIds: ReadonlySet<string>): Set<string> {
  const next = new Set<string>();
  for (const key of keys) {
    const taskId = key.split(":")[1];
    if (taskId && taskIds.has(taskId)) next.add(key);
  }
  if (next.size !== keys.size) saveOsScheduledKeys(next);
  return next;
}

function loadStringSet(storageKey: string): Set<string> {
  if (typeof localStorage === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((k): k is string => typeof k === "string"));
  } catch {
    return new Set();
  }
}

function saveStringSet(storageKey: string, keys: ReadonlySet<string>): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(storageKey, JSON.stringify([...keys]));
  } catch {
    // Quota or private mode — in-memory state still applies this session.
  }
}
