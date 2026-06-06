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
