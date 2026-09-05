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
const OS_REGISTERED_STORAGE_KEY = "pansuthong.scheduledArrivalOsRegistered";
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
export function notificationIdForKey(arrivalKey: string): number {
  const input = `${NOTIFICATION_ID_PREFIX}${arrivalKey}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  const signed = hash | 0;
  return signed === 0 ? 1 : signed;
}

/** @deprecated Prefer `notificationIdForKey(arrival.key)` so edits get distinct ids. */
export function notificationId(kind: ArrivalKind, taskId: string): number {
  return notificationIdForKey(`${kind}:${taskId}`);
}

/** Parse the local arrival instant encoded in an arrival key. */
export function arrivalMomentFromKey(key: string): Date | undefined {
  const parts = key.split(":");
  if (parts.length < 5) return undefined;
  const [year, month, day] = parts[2].split("-").map(Number);
  const hour = Number(parts[3]);
  const minute = Number(parts[4]);
  if (!year || !month || !day || !Number.isFinite(hour) || !Number.isFinite(minute)) return undefined;
  const at = new Date(year, month - 1, day, hour, minute, 0, 0);
  return Number.isNaN(at.getTime()) ? undefined : at;
}

/** True when an arrival key still matches an active, eligible task moment. */
export function isArrivalKeyEligible(
  key: string,
  tasks: Task[],
  dayStartHour: number,
): boolean {
  const taskId = key.split(":")[1];
  if (!taskId) return false;
  const match = tasks.find(t => t.id === taskId);
  if (!match) return false;
  const arrival = taskArrival(match, dayStartHour);
  return arrival?.key === key;
}

/** Stable signature of the OS schedule set; used to skip redundant re-schedules. */
export function scheduleSignature(arrivals: TaskArrival[]): string {
  return arrivals
    .map(a => a.key)
    .sort()
    .join("|");
}

/**
 * Mark arrivals delivered with explicit evidence (`active()` / `onNotificationReceived`),
 * or OS background delivery on platforms that honor scheduled notifications.
 */
export function reconcileDeliveredKeys(
  deliveredKeys: ReadonlySet<string>,
  notified: ReadonlySet<string>,
  registered: ReadonlyMap<string, number>,
): { notified: Set<string>; registered: Map<string, number> } {
  let nextNotified = new Set(notified);
  let nextRegistered = new Map(registered);

  for (const key of deliveredKeys) {
    if (!nextRegistered.has(key)) continue;
    nextNotified = markNotified(nextNotified, key);
    nextRegistered = unregisterOsNotification(nextRegistered, key);
  }

  return { notified: nextNotified, registered: nextRegistered };
}

/**
 * Infer OS delivery while the app was inactive: registered, due, and no longer pending.
 * Used on Android where `Schedule.at` can fire while backgrounded; desktop may not.
 */
export function reconcileOsBackgroundDelivered(
  registered: ReadonlyMap<string, number>,
  now: number,
  pendingIds: ReadonlySet<number>,
  trustBackgroundDelivery: boolean,
): Set<string> {
  const delivered = new Set<string>();
  if (!trustBackgroundDelivery) return delivered;

  for (const [key, id] of registered) {
    const at = arrivalMomentFromKey(key);
    if (!at || !isArrivalDue(at, now)) continue;
    if (pendingIds.has(id)) continue;
    delivered.add(key);
  }

  return delivered;
}

/**
 * Cancel registered OS notifications that are stale: the task is no longer eligible,
 * the arrival key changed (kind/date/time), or the schedule is no longer desired.
 */
export function cancelStaleRegisteredPending(
  registered: ReadonlyMap<string, number>,
  desiredFutureKeys: ReadonlySet<string>,
  tasks: Task[],
  dayStartHour: number,
  pendingIds: ReadonlySet<number>,
): { cancel: number[]; registered: Map<string, number> } {
  const cancel: number[] = [];
  let nextRegistered = new Map(registered);

  for (const [key, id] of registered) {
    const keep = desiredFutureKeys.has(key) && isArrivalKeyEligible(key, tasks, dayStartHour);
    if (keep) continue;
    if (pendingIds.has(id)) cancel.push(id);
    nextRegistered = unregisterOsNotification(nextRegistered, key);
  }

  return { cancel, registered: nextRegistered };
}

export function loadNotifiedKeys(): Set<string> {
  return loadStringSet(NOTIFIED_STORAGE_KEY);
}

export function loadRegisteredOsNotifications(): Map<string, number> {
  if (typeof localStorage === "undefined") return new Map();
  try {
    const raw = localStorage.getItem(OS_REGISTERED_STORAGE_KEY);
    if (!raw) return new Map();
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return new Map();
    const out = new Map<string, number>();
    for (const [key, id] of Object.entries(parsed)) {
      if (typeof key === "string" && typeof id === "number") out.set(key, id);
    }
    return out;
  } catch {
    return new Map();
  }
}

export function saveNotifiedKeys(keys: ReadonlySet<string>): void {
  saveStringSet(NOTIFIED_STORAGE_KEY, keys);
}

export function saveRegisteredOsNotifications(registered: ReadonlyMap<string, number>): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(OS_REGISTERED_STORAGE_KEY, JSON.stringify(Object.fromEntries(registered)));
  } catch {
    // Quota or private mode — in-memory state still applies this session.
  }
}

export function markNotified(keys: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(keys);
  next.add(key);
  saveNotifiedKeys(next);
  return next;
}

export function registerOsNotification(
  registered: ReadonlyMap<string, number>,
  key: string,
  id: number,
): Map<string, number> {
  const next = new Map(registered);
  next.set(key, id);
  saveRegisteredOsNotifications(next);
  return next;
}

export function unregisterOsNotification(
  registered: ReadonlyMap<string, number>,
  key: string,
): Map<string, number> {
  const next = new Map(registered);
  next.delete(key);
  saveRegisteredOsNotifications(next);
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
