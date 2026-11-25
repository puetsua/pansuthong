import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Settings } from "../../lib/tauri";
import { ToggleSwitch } from "./ToggleSwitch";
import { SettingRow, SettingsSection } from "./SettingRow";
import { api } from "../../lib/tauri";
import { isAndroid } from "../../lib/platform";
import { errorMessage } from "../../lib/errors";

// Saves directly (not via the page-level applySettings) so a failed OS write for
// launch at login is reported under that setting, not at the top of Settings.
type Props = { settings: Settings };

/** Desktop (#252): what closing the window does, and launch at login. */
export function BackgroundSection({ settings }: Props) {
  const { t } = useTranslation();
  const [android, setAndroid] = useState<boolean | null>(null);
  const [trayAvailable, setTrayAvailable] = useState(true);
  const [err, setErr] = useState<{ field: "close" | "login"; message: string } | null>(null);

  const save = async (field: "close" | "login", patch: Partial<Settings>) => {
    setErr(null);
    try {
      await api.updateSettings(patch);
    } catch (e) {
      setErr({ field, message: errorMessage(e) });
    }
  };

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    // A Linux tray host can appear or go away after Settings opened.
    const refresh = () => {
      void api.getBackgroundStatus()
        .then(s => { if (active) setTrayAvailable(s.tray_available); })
        .catch(() => {});
    };
    void isAndroid().then(a => {
      if (!active) return;
      setAndroid(a);
      if (a) return;
      // Listen first, then read, so a change in between isn't missed.
      void api.onTrayStatusChanged(refresh)
        .then(un => { if (active) unlisten = un; else un(); })
        .catch(() => {})
        .finally(refresh);
    });
    return () => {
      active = false;
      unlisten?.();
    };
  }, []);

  if (android !== false) return null;

  const closeToTray = trayAvailable && (settings.close_to_tray ?? true);
  const launchAtLogin = settings.launch_at_login ?? false;

  const saveError = (field: "close" | "login") =>
    err?.field === field && <p className="composer-error" role="alert">{t("settings.saveError", { error: err.message })}</p>;

  return (
    <SettingsSection title={t("settings.background.title")}>
      <SettingRow
        title={t("settings.background.onClose")}
        description={t("settings.background.sub")}
        footer={<>
          {!trayAvailable && <p className="settings-status" role="status">{t("settings.background.noTray")}</p>}
          {saveError("close")}
        </>}
      >
        <select
          className="select-input"
          aria-label={t("settings.background.onClose")}
          value={closeToTray ? "tray" : "quit"}
          disabled={!trayAvailable}
          onChange={e => { void save("close", { close_to_tray: e.currentTarget.value === "tray" }); }}
        >
          <option value="tray">{t("settings.background.closeToTray")}</option>
          <option value="quit">{t("settings.background.closeQuits")}</option>
        </select>
      </SettingRow>

      <SettingRow
        title={t("settings.background.launchAtLogin")}
        footer={saveError("login")}
      >
        <ToggleSwitch
          label={t("settings.background.launchAtLogin")}
          checked={launchAtLogin}
          onChange={on => { void save("login", { launch_at_login: on }); }}
        />
      </SettingRow>
    </SettingsSection>
  );
}
