import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Settings } from "../../lib/tauri";
import { ToggleSwitch } from "./ToggleSwitch";
import { api } from "../../lib/tauri";
import { isAndroid } from "../../lib/platform";
import { errorMessage } from "../../lib/errors";

// Saves directly (not via the page-level applySettings) so a failed OS write for
// launch at login is reported next to the control, not at the top of Settings.
type Props = { settings: Settings };

/** Desktop (#252): what closing the window does, and launch at login. */
export function BackgroundSection({ settings }: Props) {
  const { t } = useTranslation();
  const [android, setAndroid] = useState<boolean | null>(null);
  const [trayAvailable, setTrayAvailable] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const save = async (patch: Partial<Settings>) => {
    setErr(null);
    try {
      await api.updateSettings(patch);
    } catch (e) {
      setErr(errorMessage(e));
    }
  };

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
      {err && <p className="composer-error" role="alert">{t("settings.saveError", { error: err })}</p>}

      <label className="te-field">
        <span>{t("settings.background.onClose")}</span>
        <select
          className="select-input"
          value={closeToTray ? "tray" : "quit"}
          disabled={!trayAvailable}
          onChange={e => { void save({ close_to_tray: e.currentTarget.value === "tray" }); }}
        >
          <option value="tray">{t("settings.background.closeToTray")}</option>
          <option value="quit">{t("settings.background.closeQuits")}</option>
        </select>
      </label>
      {!trayAvailable && <p className="settings-status" role="status">{t("settings.background.noTray")}</p>}

      <ToggleSwitch
        label={t("settings.background.launchAtLogin")}
        checked={launchAtLogin}
        onChange={on => { void save({ launch_at_login: on }); }}
      />
    </section>
  );
}
