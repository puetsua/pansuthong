import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import type { Settings } from "../lib/tauri";
import {
  THEME_PRESETS, EDITABLE_TOKENS, DEFAULT_PRESET_ID, resolveThemeVars,
  type ThemeVariant,
} from "../lib/themes";

/** The slice of the settings patch this component writes (#15). A subset of the
 *  full `updateSettings` input, so SettingsView's `applySettings` is assignable. */
export type ThemeSettingsPatch = {
  theme?: "auto" | "light" | "dark";
  theme_preset?: string;
  theme_colors_light?: Record<string, string>;
  theme_colors_dark?: Record<string, string>;
};

type Props = {
  settings: Settings;
  applySettings: (patch: ThemeSettingsPatch) => void;
};

const MODES = ["auto", "light", "dark"] as const;

// Editable token -> i18n label key. Mirrors EDITABLE_TOKENS' curated four (#15).
const TOKEN_LABEL: Record<(typeof EDITABLE_TOKENS)[number], string> = {
  "--c-accent": "settings.themeColorAccent",
  "--c-bg": "settings.themeColorBackground",
  "--c-surface": "settings.themeColorSurface",
  "--c-text": "settings.themeColorText",
};

type VariantRow = {
  variant: ThemeVariant;
  key: "theme_colors_light" | "theme_colors_dark";
  label: string;
};

export function ThemeSettings({ settings, applySettings }: Props) {
  const { t } = useTranslation();
  const presetId = settings.theme_preset ?? DEFAULT_PRESET_ID;

  const variants: VariantRow[] = [
    { variant: "light", key: "theme_colors_light", label: t("settings.themeLightGroup") },
    { variant: "dark", key: "theme_colors_dark", label: t("settings.themeDarkGroup") },
  ];

  const setColor = (key: VariantRow["key"], token: string, value: string) => {
    const next = { ...(settings[key] ?? {}), [token]: value };
    applySettings(key === "theme_colors_light" ? { theme_colors_light: next } : { theme_colors_dark: next });
  };
  const resetVariant = (key: VariantRow["key"]) => {
    applySettings(key === "theme_colors_light" ? { theme_colors_light: {} } : { theme_colors_dark: {} });
  };

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

      <h3 className="settings-subhead">{t("settings.themePreset")}</h3>
      <p className="view-sub">{t("settings.themePresetSub")}</p>
      <div className="theme-presets">
        {THEME_PRESETS.map(p => (
          <button
            key={p.id}
            type="button"
            className={`theme-preset ${presetId === p.id ? "active" : ""}`}
            aria-pressed={presetId === p.id}
            onClick={() => applySettings({ theme_preset: p.id })}
          >
            <span
              className="theme-preset-swatch"
              aria-hidden="true"
              style={{
                "--sw-light": p.light["--c-surface"],
                "--sw-dark": p.dark["--c-surface"],
                "--sw-accent": p.light["--c-accent"],
              } as CSSProperties}
            />
            <span>{t(p.nameKey)}</span>
          </button>
        ))}
      </div>

      <h3 className="settings-subhead">{t("settings.customizeColors")}</h3>
      <p className="view-sub">{t("settings.customizeColorsSub")}</p>
      <div className="theme-color-groups">
        {variants.map(({ variant, key, label }) => {
          const resolved = resolveThemeVars(settings, variant);
          return (
            <div className="theme-color-group" key={variant}>
              <div className="theme-color-group-head">
                <h4>{label}</h4>
                <button
                  type="button"
                  className="theme-option"
                  aria-label={`${t("settings.resetToPreset")} ${label}`}
                  onClick={() => resetVariant(key)}
                >
                  {t("settings.resetToPreset")}
                </button>
              </div>
              {EDITABLE_TOKENS.map(token => (
                <label className="theme-color-row" key={token}>
                  <span>{t(TOKEN_LABEL[token])}</span>
                  <input
                    type="color"
                    aria-label={`${label} ${t(TOKEN_LABEL[token])}`}
                    value={resolved[token]}
                    onChange={e => setColor(key, token, e.currentTarget.value)}
                  />
                </label>
              ))}
            </div>
          );
        })}
      </div>
    </section>
  );
}
