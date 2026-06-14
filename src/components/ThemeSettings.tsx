import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Settings } from "../lib/tauri";
import { THEME_PRESETS, DEFAULT_PRESET_ID, getPreset, fullTokens, type ThemeSettingsPatch } from "../lib/themes";
import { ThemePickerModal } from "./ThemePickerModal";

export type { ThemeSettingsPatch };

type Props = {
  settings: Settings;
  applySettings: (patch: ThemeSettingsPatch) => void;
};

const MODES = ["auto", "light", "dark"] as const;
const PREVIEW_TOKENS = ["--c-bg", "--c-surface", "--c-accent", "--c-text"] as const;

export function ThemeSettings({ settings, applySettings }: Props) {
  const { t } = useTranslation();
  const [pickerOpen, setPickerOpen] = useState(false);

  const presetId = settings.theme_preset ?? DEFAULT_PRESET_ID;
  const builtin = THEME_PRESETS.find(p => p.id === presetId);
  const custom = builtin ? undefined : settings.custom_presets?.find(p => p.id === presetId);
  // The currently-selected theme's display name + preview tokens (fall back to the
  // default built-in when the active id is unknown, e.g. a deleted custom).
  const current = builtin
    ? { name: t(builtin.nameKey), light: builtin.light, dark: builtin.dark }
    : custom
      ? { name: custom.name, light: fullTokens(custom.light, "light"), dark: fullTokens(custom.dark, "dark") }
      : { name: t(getPreset("default").nameKey), light: getPreset("default").light, dark: getPreset("default").dark };

  return (
    <section className="settings-section">
      <h2>{t("settings.theme")}</h2>
      <div className="theme-options">
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
      </div>

      <p className="view-sub">{t("settings.themePresetSub")}</p>
      <div className="theme-current">
        <span className="theme-palette" aria-hidden="true">
          {(["light", "dark"] as const).map(v => (
            <span className="theme-palette-row" key={v}>
              {PREVIEW_TOKENS.map(tk => (
                <span key={tk} className="theme-palette-swatch" style={{ background: current[v][tk] }} />
              ))}
            </span>
          ))}
        </span>
        <span className="theme-current-name">{current.name}</span>
        <button type="button" className="theme-option" onClick={() => setPickerOpen(true)}>
          {t("settings.themeChoose")}
        </button>
      </div>

      {pickerOpen && (
        <ThemePickerModal settings={settings} applySettings={applySettings} onClose={() => setPickerOpen(false)} />
      )}
    </section>
  );
}
