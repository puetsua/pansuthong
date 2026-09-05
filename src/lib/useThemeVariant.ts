import { useEffect, useState } from "react";
import type { Settings } from "./tauri";
import { activeVariant, prefersDarkScheme, type ThemeVariant } from "./themes";

/** Reactive active light/dark variant from settings (or DOM when omitted). */
export function useThemeVariant(settings?: Pick<Settings, "theme">): ThemeVariant {
  const themeSetting = settings?.theme
    ?? (typeof document !== "undefined"
      ? (document.documentElement.getAttribute("data-theme") as Settings["theme"] | null)
      : null)
    ?? "auto";
  const [prefersDark, setPrefersDark] = useState(prefersDarkScheme);

  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return;
    const onChange = () => setPrefersDark(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return activeVariant(themeSetting, prefersDark);
}
