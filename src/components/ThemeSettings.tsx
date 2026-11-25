import { useTranslation } from "react-i18next";
import type { Settings } from "../lib/tauri";
import type { ThemeSettingsPatch } from "../lib/themes";
import { ThemeGallery } from "./ThemeGallery";
import { SettingRow, SettingsSection } from "./settings/SettingRow";

export type { ThemeSettingsPatch };

type Props = {
  settings: Settings;
  applySettings: (patch: ThemeSettingsPatch) => void;
};

const MODES = ["auto", "light", "dark"] as const;

/** Appearance: light/dark mode, then the full theme gallery inline. */
export function ThemeSettings({ settings, applySettings }: Props) {
  const { t } = useTranslation();
  return (
    <>
      <SettingsSection title={t("settings.theme")}>
        <SettingRow title={t("settings.themeMode")} description={t("settings.themeModeSub")}>
          {MODES.map(opt => (
            <button
              key={opt}
              className={`theme-option ${settings.theme === opt ? "active" : ""}`}
              aria-pressed={settings.theme === opt}
              onClick={() => applySettings({ theme: opt })}
            >
              {t(`settings.theme${opt[0].toUpperCase()}${opt.slice(1)}`)}
            </button>
          ))}
        </SettingRow>
      </SettingsSection>

      <SettingsSection title={t("settings.themePreset")}>
        <ThemeGallery settings={settings} applySettings={applySettings} />
      </SettingsSection>
    </>
  );
}
