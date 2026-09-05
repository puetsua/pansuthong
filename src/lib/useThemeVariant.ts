import { useEffect, useState } from "react";
import type { Settings } from "./tauri";
import { activeVariant, prefersDarkScheme, type ThemeVariant } from "./themes";

/** Read the theme the store effect writes on `<html data-theme>`. */
export function domThemeSetting(): Settings["theme"] {
  if (typeof document === "undefined") return "auto";
  const raw = document.documentElement.getAttribute("data-theme");
  return raw === "light" || raw === "dark" ? raw : "auto";
}

/** Reactive active light/dark variant from settings, or from DOM when omitted. */
export function useThemeVariant(settings?: Pick<Settings, "theme">): ThemeVariant {
  const [domTheme, setDomTheme] = useState<Settings["theme"]>(domThemeSetting);
  const [prefersDark, setPrefersDark] = useState(prefersDarkScheme);

  const themeSetting = settings?.theme ?? domTheme;

  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    const syncPrefers = () => setPrefersDark(mq?.matches ?? false);
    syncPrefers();
    mq?.addEventListener("change", syncPrefers);

    if (settings?.theme) {
      return () => mq?.removeEventListener("change", syncPrefers);
    }

    const root = document.documentElement;
    const syncDom = () => setDomTheme(domThemeSetting());
    const observer = new MutationObserver(syncDom);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    syncDom();

    return () => {
      mq?.removeEventListener("change", syncPrefers);
      observer.disconnect();
    };
  }, [settings?.theme]);

  return activeVariant(themeSetting, prefersDark);
}
