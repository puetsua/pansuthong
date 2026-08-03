import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { isAndroid } from "./platform";

/**
 * Check GitHub for a newer release. Resolves to the pending `Update`, or `null`
 * when there's nothing to do: on Android (the updater plugin is desktop-only and
 * calling it there would throw), when already up to date, or on any error — a
 * failed/offline check must never block startup or nag the user.
 */
export async function checkForUpdate(): Promise<Update | null> {
  if (await isAndroid()) return null;
  try {
    return await check();
  } catch {
    return null;
  }
}

// The pending update found by the startup check, published so the sidebar can
// offer a way back in after the prompt is dismissed. Module state rather than
// context because the publisher (UpdatePrompt) and the reader (Sidebar) live in
// different subtrees, and there is at most one pending update per run.
let pendingUpdate: Update | null = null;
const pendingListeners = new Set<() => void>();

/** The update the startup check found, or `null` if there is none (yet). */
export function getPendingUpdate(): Update | null {
  return pendingUpdate;
}

/**
 * Publish an update to every subscriber. Called by `UpdatePrompt` with the
 * startup check's result (and by tests directly). Nothing in production ever
 * resets it to `null` — a found update stays offered for the process lifetime,
 * since the only ways out are installing it or quitting. The guard is reference
 * identity, so re-publishing an equal-but-distinct `Update` still notifies.
 */
export function setPendingUpdate(update: Update | null): void {
  if (pendingUpdate === update) return;
  pendingUpdate = update;
  for (const listener of pendingListeners) listener();
}

/**
 * Subscribe to {@link getPendingUpdate} changes; returns the unsubscribe
 * function. Shaped for `useSyncExternalStore` — `getPendingUpdate` hands back
 * the module variable itself, so the snapshot is reference-stable.
 */
export function subscribeToPendingUpdate(listener: () => void): () => void {
  pendingListeners.add(listener);
  return () => {
    pendingListeners.delete(listener);
  };
}

const SHOW_EVENT = "pansutong:show-update-prompt";

/**
 * Ask the mounted `UpdatePrompt` to reopen for the pending update. Fired by the
 * sidebar's Update button, which exists so "Later" is not a one-way door until
 * relaunch. A window event because the trigger and the dialog are in different
 * subtrees. Silently does nothing when no update is pending or the prompt is
 * already on screen — callers get no signal either way.
 */
export function requestUpdatePrompt(): void {
  window.dispatchEvent(new Event(SHOW_EVENT));
}

/** Subscribe to {@link requestUpdatePrompt}; returns the unsubscribe function. */
export function onUpdatePromptRequested(handler: () => void): () => void {
  window.addEventListener(SHOW_EVENT, handler);
  return () => window.removeEventListener(SHOW_EVENT, handler);
}

/**
 * Download and install `update`, then relaunch into the new version. `onProgress`
 * receives a 0..1 fraction as bytes arrive; it stays at 0 until the total content
 * length is known and jumps to 1 on completion.
 */
export async function installUpdate(
  update: Update,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  let total = 0;
  let downloaded = 0;
  await update.downloadAndInstall(event => {
    switch (event.event) {
      case "Started":
        total = event.data.contentLength ?? 0;
        break;
      case "Progress":
        downloaded += event.data.chunkLength;
        if (total > 0) onProgress?.(downloaded / total);
        break;
      case "Finished":
        onProgress?.(1);
        break;
    }
  });
  await relaunch();
}
