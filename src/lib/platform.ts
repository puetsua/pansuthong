import { locale, type } from "@tauri-apps/plugin-os";

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

/** The OS locale (e.g. "en-US", "zh-TW"), or null if unavailable — used to resolve
 *  the "auto" language setting to a concrete UI language (#26). */
export async function osLocale(): Promise<string | null> {
  try {
    return await locale();
  } catch {
    return null;
  }
}
