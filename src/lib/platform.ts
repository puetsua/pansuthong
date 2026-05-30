import { type } from "@tauri-apps/plugin-os";

let cached: boolean | null = null;

/** True when running on Android (the desktop sync-folder picker is hidden there). */
export async function isAndroid(): Promise<boolean> {
  if (cached === null) {
    try {
      cached = (await type()) === "android";
    } catch {
      cached = false;
    }
  }
  return cached;
}
