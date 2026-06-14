import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Settings, ThemePreset } from "../lib/tauri";
import {
  THEME_PRESETS, DEFAULT_PRESET_ID, ThemeTokens, ThemeVariant,
  sanitizeTokens, parseThemeJson, serializeThemeJson,
} from "../lib/themes";
import { ThemeEditorModal } from "./ThemeEditorModal";

/** The slice of the settings patch this component writes (#15). A subset of the
 *  full `updateSettings` input, so SettingsView's `applySettings` is assignable. */
export type ThemeSettingsPatch = {
  theme?: "auto" | "light" | "dark";
  theme_preset?: string;
  custom_presets?: ThemePreset[];
};

type Props = {
  settings: Settings;
  applySettings: (patch: ThemeSettingsPatch) => void;
};

const MODES = ["auto", "light", "dark"] as const;
// Representative tokens shown in a card's palette preview.
const PREVIEW_TOKENS = ["--c-bg", "--c-surface", "--c-accent", "--c-text"] as const;

type Card = { id: string; name: string; light: ThemeTokens; dark: ThemeTokens; custom: boolean };
type EditState = { preset: ThemePreset; existing: boolean } | null;

const base = THEME_PRESETS[0];
/** Fill a (possibly partial) custom map up to a complete variant map. */
function fullTokens(map: Record<string, string> | undefined, variant: ThemeVariant): ThemeTokens {
  return { ...base[variant], ...sanitizeTokens(map) };
}
const newId = () => `custom_${crypto.randomUUID()}`;

export function ThemeSettings({ settings, applySettings }: Props) {
  const { t } = useTranslation();
  const presetId = settings.theme_preset ?? DEFAULT_PRESET_ID;
  const customs = settings.custom_presets ?? [];
  const [edit, setEdit] = useState<EditState>(null);
  const [importText, setImportText] = useState("");
  const [importErr, setImportErr] = useState<string | null>(null);

  const cards: Card[] = [
    ...THEME_PRESETS.map(p => ({ id: p.id, name: t(p.nameKey), light: p.light, dark: p.dark, custom: false })),
    ...customs.map(p => ({
      id: p.id, name: p.name,
      light: fullTokens(p.light, "light"), dark: fullTokens(p.dark, "dark"), custom: true,
    })),
  ];

  const select = (id: string) => applySettings({ theme_preset: id });

  const saveEdit = (preset: ThemePreset) => {
    const others = customs.filter(p => p.id !== preset.id);
    applySettings({ custom_presets: [...others, preset], theme_preset: preset.id });
    setEdit(null);
  };

  const deleteCustom = (id: string, name: string) => {
    if (!window.confirm(t("settings.themeDeleteConfirm", { name }))) return;
    const patch: ThemeSettingsPatch = { custom_presets: customs.filter(p => p.id !== id) };
    if (presetId === id) patch.theme_preset = "default";
    applySettings(patch);
    setEdit(null);
  };

  const startNew = () =>
    setEdit({ preset: { id: newId(), name: "", light: { ...base.light }, dark: { ...base.dark } }, existing: false });
  const startDuplicate = (c: Card) =>
    setEdit({
      preset: { id: newId(), name: `${c.name} ${t("settings.themeCopySuffix")}`, light: { ...c.light }, dark: { ...c.dark } },
      existing: false,
    });
  const startEdit = (c: Card) =>
    setEdit({ preset: { id: c.id, name: c.name, light: { ...c.light }, dark: { ...c.dark } }, existing: true });
  const exportCard = (c: Card) =>
    void navigator.clipboard?.writeText(serializeThemeJson(c.name, c.light, c.dark)).catch(() => {});

  const doImport = () => {
    try {
      const { name, light, dark } = parseThemeJson(importText);
      const preset: ThemePreset = { id: newId(), name, light, dark };
      applySettings({ custom_presets: [...customs, preset], theme_preset: preset.id });
      setImportText("");
      setImportErr(null);
    } catch (e) {
      setImportErr(t((e as Error).message));
    }
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

      <p className="view-sub">{t("settings.themePresetSub")}</p>
      <div className="theme-gallery">
        {cards.map(c => (
          <div className={`theme-card ${presetId === c.id ? "active" : ""}`} key={c.id}>
            <button type="button" className="theme-card-select" aria-pressed={presetId === c.id} onClick={() => select(c.id)}>
              <span className="theme-palette" aria-hidden="true">
                {(["light", "dark"] as const).map(v => (
                  <span className="theme-palette-row" key={v}>
                    {PREVIEW_TOKENS.map(tk => (
                      <span key={tk} className="theme-palette-swatch" style={{ background: c[v][tk] }} />
                    ))}
                  </span>
                ))}
              </span>
              <span className="theme-card-name">{c.name}</span>
            </button>
            <div className="theme-card-actions">
              {c.custom && (
                <button type="button" aria-label={`${t("settings.themeEdit")} ${c.name}`} onClick={() => startEdit(c)}>
                  {t("settings.themeEdit")}
                </button>
              )}
              <button type="button" aria-label={`${t("settings.themeDuplicate")} ${c.name}`} onClick={() => startDuplicate(c)}>
                {t("settings.themeDuplicate")}
              </button>
              <button type="button" aria-label={`${t("settings.themeExport")} ${c.name}`} onClick={() => exportCard(c)}>
                {t("settings.themeExport")}
              </button>
              {c.custom && (
                <button type="button" className="theme-card-delete" aria-label={`${t("settings.themeDelete")} ${c.name}`}
                        onClick={() => deleteCustom(c.id, c.name)}>
                  {t("settings.themeDelete")}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="theme-gallery-actions">
        <button type="button" className="theme-option" onClick={startNew}>{t("settings.themeNewPreset")}</button>
      </div>

      <details className="theme-import">
        <summary>{t("settings.themeImport")}</summary>
        <textarea
          className="theme-json"
          aria-label={t("settings.themeImport")}
          placeholder={t("settings.themeImportPlaceholder")}
          rows={4}
          value={importText}
          onChange={e => { setImportText(e.currentTarget.value); setImportErr(null); }}
        />
        {importErr && <p className="composer-error" role="alert">{importErr}</p>}
        <button type="button" className="theme-option" onClick={doImport} disabled={!importText.trim()}>
          {t("settings.themeImportButton")}
        </button>
      </details>

      {edit && (
        <ThemeEditorModal
          preset={edit.preset}
          onSave={saveEdit}
          onClose={() => setEdit(null)}
          onDelete={edit.existing ? () => deleteCustom(edit.preset.id, edit.preset.name) : undefined}
        />
      )}
    </section>
  );
}
