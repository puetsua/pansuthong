import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isAndroid } from "./platform";

/** Cross-platform pending update surfaced to UpdatePrompt and the sidebar. */
export type AppUpdate = {
  version: string;
  body?: string | null;
  downloadAndInstall: (
    onEvent: (event: { event: string; data: { chunkLength?: number; contentLength?: number } }) => void,
  ) => Promise<void>;
};

type AndroidUpdateInfo = {
  version: string;
  body?: string | null;
  downloadUrl: string;
};

function wrapDesktopUpdate(update: Update): AppUpdate {
  return {
    version: update.version,
    body: update.body,
    downloadAndInstall: onEvent => update.downloadAndInstall(onEvent),
  };
}

function wrapAndroidUpdate(info: AndroidUpdateInfo): AppUpdate {
  return {
    version: info.version,
    body: info.body,
    downloadAndInstall: async onEvent => {
      let total = 0;
      const unlisten = await listen<{ downloaded: number; total?: number }>(
        "android-updater://progress",
        ({ payload }) => {
          if (payload.total != null && payload.total > 0) {
            total = payload.total;
            onEvent({
              event: "Started",
              data: { contentLength: total },
            });
          }
          onEvent({
            event: "Progress",
            data: { chunkLength: payload.downloaded },
          });
        },
      );
      try {
        await invoke("plugin:android-updater|download_and_install", {
          downloadUrl: info.downloadUrl,
        });
        onEvent({ event: "Finished", data: {} });
      } finally {
        unlisten();
      }
    },
  };
}

/**
 * Check for a newer release. Resolves to the pending update, or `null` when
 * there's nothing to do: when already up to date, or on any error — a failed or
 * offline check must never block startup or nag the user.
 */
export async function checkForUpdate(): Promise<AppUpdate | null> {
  if (await isAndroid()) {
    try {
      const info = await invoke<AndroidUpdateInfo | null>("plugin:android-updater|check");
      return info ? wrapAndroidUpdate(info) : null;
    } catch {
      return null;
    }
  }
  try {
    const update = await check();
    return update ? wrapDesktopUpdate(update) : null;
  } catch {
    return null;
  }
}

// The pending update found by the startup check, published so the sidebar can
// offer a way back in after the prompt is dismissed. Module state rather than
// context because the publisher (UpdatePrompt) and the reader (Sidebar) live in
// different subtrees, and there is at most one pending update per run.
let pendingUpdate: AppUpdate | null = null;
const pendingListeners = new Set<() => void>();

/** The update the startup check found, or `null` if there is none (yet). */
export function getPendingUpdate(): AppUpdate | null {
  return pendingUpdate;
}

/**
 * Publish an update to every subscriber. Called by `UpdatePrompt` with the
 * startup check's result (and by tests directly). Nothing in production ever
 * resets it to `null` — a found update stays offered for the process lifetime,
 * since the only ways out are installing it or quitting. The guard is reference
 * identity, so re-publishing an equal-but-distinct `AppUpdate` still notifies.
 */
export function setPendingUpdate(update: AppUpdate | null): void {
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
 * Download and install `update`, then relaunch into the new version on desktop.
 * On Android the system installer replaces the app; relaunch is not attempted.
 * `onProgress` receives a 0..1 fraction as bytes arrive.
 */
export async function installUpdate(
  update: AppUpdate,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  let total = 0;
  let downloaded = 0;
  const android = await isAndroid();
  await update.downloadAndInstall(event => {
    switch (event.event) {
      case "Started":
        total = event.data.contentLength ?? 0;
        if (android && total === 0) {
          // Android progress events carry absolute downloaded bytes; fraction
          // is computed once total is known from the first progress payload.
        }
        break;
      case "Progress":
        if (android) {
          downloaded = event.data.chunkLength ?? downloaded;
          if (total > 0) onProgress?.(downloaded / total);
        } else {
          downloaded += event.data.chunkLength ?? 0;
          if (total > 0) onProgress?.(downloaded / total);
        }
        break;
      case "Finished":
        onProgress?.(1);
        break;
    }
  });
  if (!android) await relaunch();
}
