import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import dayjs from "dayjs";
import "dayjs/locale/zh-tw";
import en from "./locales/en.json";
import zhTW from "./locales/zh-TW.json";

/** The languages the app ships catalogs for (besides the "auto" follow-OS mode). */
export const SUPPORTED_LANGUAGES = ["en", "zh-TW"] as const;
export type AppLanguage = (typeof SUPPORTED_LANGUAGES)[number];

/** Maps an app language to the matching bundled dayjs locale id. */
const DAYJS_LOCALE: Record<AppLanguage, string> = { en: "en", "zh-TW": "zh-tw" };

// Initialise synchronously with the catalogs bundled in — no async backend — so the
// very first render (and the test environment) always has English strings ready.
// OS-locale detection and switching are deferred to applyLanguage(), called from the
// app once settings load, keeping this module free of any Tauri calls.
void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, "zh-TW": { translation: zhTW } },
  lng: "en",
  fallbackLng: "en",
  interpolation: { escapeValue: false }, // React already escapes
  react: { useSuspense: false },
});

/**
 * Resolve the effective app language from the stored setting and the OS locale.
 * `"auto"` (or an unknown/missing value) follows the OS locale, mapping any
 * Chinese variant to Traditional Chinese; everything else falls back to English.
 */
export function resolveLanguage(setting: string | undefined, osLocale: string | null): AppLanguage {
  if (setting && setting !== "auto" && (SUPPORTED_LANGUAGES as readonly string[]).includes(setting)) {
    return setting as AppLanguage;
  }
  const loc = (osLocale ?? "").toLowerCase();
  if (loc.startsWith("zh")) return "zh-TW";
  return "en";
}

/** Switch both i18next and dayjs to the given language. */
export function applyLanguage(lang: AppLanguage): void {
  void i18n.changeLanguage(lang);
  dayjs.locale(DAYJS_LOCALE[lang]);
}

/** The active BCP-47 locale, for Intl/`toLocaleString` date formatting. */
export function currentLocale(): string {
  return i18n.language || "en";
}

export default i18n;
