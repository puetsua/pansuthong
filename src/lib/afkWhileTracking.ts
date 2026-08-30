import { api } from "./tauri";
import { MS_PER_MINUTE } from "./duration";

/** Idle time at or above this is AFK while a timer is running (#170). Not a setting. */
export const AFK_THRESHOLD_MS = 5 * MS_PER_MINUTE;

/** Remember AFK start while idle stays over the threshold; prompt when input resumes. */
export function pollAfk(
  idleMs: number | null,
  nowMs: number,
  thresholdMs: number,
  running: boolean,
  afkSinceMs: number | null,
): { afkSinceMs: number | null; prompt: boolean } {
  if (!running) return { afkSinceMs: null, prompt: false };
  // A failed/unavailable poll must not forget an AFK span we already recorded.
  if (idleMs == null) return { afkSinceMs, prompt: false };
  if (idleMs >= thresholdMs) {
    return { afkSinceMs: afkSinceMs ?? nowMs - idleMs, prompt: false };
  }
  if (afkSinceMs != null) return { afkSinceMs, prompt: true };
  return { afkSinceMs: null, prompt: false };
}

/** AFK start to use when Stop is hit, or `null` if this Stop should go through. */
export function afkSinceForStop(
  idleMs: number | null,
  nowMs: number,
  thresholdMs: number,
  afkSinceMs: number | null,
  lastIdleMs: number | null,
): number | null {
  if (afkSinceMs != null) return afkSinceMs;
  if (idleMs != null && idleMs >= thresholdMs) return nowMs - idleMs;
  if (lastIdleMs != null && lastIdleMs >= thresholdMs) return nowMs - lastIdleMs;
  return null;
}

/**
 * Return true when the Stop click was held for the AFK dialog (do not call
 * `stop_timer` yet). Absent handler = no AFK prompt mounted.
 */
export type AfkStopHandler = (taskId: string) => Promise<boolean>;

let stopHandler: AfkStopHandler | null = null;

export function setAfkStopHandler(handler: AfkStopHandler | null): void {
  stopHandler = handler;
}

/** Stop a timer, unless an AFK prompt needs to run first (#170). */
export async function requestStopTimer(taskId: string): Promise<void> {
  if (stopHandler && (await stopHandler(taskId))) return;
  await api.stopTimer(taskId);
}
