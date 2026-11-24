import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Settings } from "../../lib/tauri";
import { api } from "../../lib/tauri";
import { isAndroid } from "../../lib/platform";
import type { ApplySettings } from "./types";

type Props = { settings: Settings; applySettings: ApplySettings };

/** Desktop (#252): what closing the window does, and launch at login. */
export function BackgroundSection({ settings, applySettings }: Props) {
  const { t } = useTranslation();
  const [android, setAndroid] = useState<boolean | null>(null);
  const [trayAvailable, setTrayAvailable] = useState(true);

  useEffect(() => {
    let active = true;
    void isAndroid().then(a => {
      if (!active) return;
      setAndroid(a);
      if (a) return;
      void api.getBackgroundStatus()
        .then(s => { if (active) setTrayAvailable(s.tray_available); })
        .catch(() => {});
    });
    return () => { active = false; };
  }, []);

  if (android !== false) return null;

  const closeToTray = trayAvailable && (settings.close_to_tray ?? true);
  const launchAtLogin = settings.launch_at_login ?? false;

  return (
    <section className="settings-section">
      <h2>{t("settings.background.title")}</h2>
      <p className="view-sub">{t("settings.background.sub")}</p>

      {/* A div, not a label: a label would forward clicks to its first button. */}
      <div className="te-field">
        <span id="background-on-close">{t("settings.background.onClose")}</span>
        <div className="theme-options" role="group" aria-labelledby="background-on-close">
          {([[true, t("settings.background.closeToTray")], [false, t("settings.background.closeQuits")]] as const).map(([on, label]) => (
            <button
              key={String(on)}
              type="button"
              className={`theme-option ${closeToTray === on ? "active" : ""}`}
              aria-pressed={closeToTray === on}
              disabled={!trayAvailable}
              onClick={() => { void applySettings({ close_to_tray: on }); }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {!trayAvailable && <p className="view-sub" role="status">{t("settings.background.noTray")}</p>}

      <label className="te-field te-field-row">
        <span>{t("settings.background.launchAtLogin")}</span>
        <button
          type="button"
          className={`theme-option ${launchAtLogin ? "active" : ""}`}
          aria-pressed={launchAtLogin}
          onClick={() => { void applySettings({ launch_at_login: !launchAtLogin }); }}
        >
          {launchAtLogin ? t("settings.background.on") : t("settings.background.off")}
        </button>
      </label>
    </section>
  );
}
