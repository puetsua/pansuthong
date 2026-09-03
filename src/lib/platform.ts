import { locale, type } from "@tauri-apps/plugin-os";
import { getVersion } from "@tauri-apps/api/app";

let cached: boolean | null = null;

/** True when running on Linux (native GTK titlebar drag is used there). */
export async function isLinux(): Promise<boolean> {
  try {
    return (await type()) === "linux";
  } catch {
    return false;
  }
}

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

/** The running app version (e.g. "0.5.0"), or null when unavailable (e.g. outside
 *  the Tauri runtime in tests) so callers can simply omit the label. */
export async function appVersion(): Promise<string | null> {
  try {
    return await getVersion();
  } catch {
    return null;
  }
}
