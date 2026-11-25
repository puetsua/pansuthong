import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Settings, ThemePreset } from "../lib/tauri";
import {
  THEME_PRESETS, DEFAULT_PRESET_ID, ThemeTokens,
  fullTokens, activeVariant, prefersDarkScheme, type ThemeSettingsPatch,
} from "../lib/themes";
import { ThemeEditorModal } from "./ThemeEditorModal";

type Props = {
  settings: Settings;
  applySettings: (patch: ThemeSettingsPatch) => void;
};

// Representative tokens shown in a card's palette preview.
const PREVIEW_TOKENS = ["--c-bg", "--c-surface", "--c-accent", "--c-text"] as const;

type Card = { id: string; name: string; light: ThemeTokens; dark: ThemeTokens; custom: boolean };
type EditState = { preset: ThemePreset; existing: boolean } | null;

const base = THEME_PRESETS[0];
const newId = () => `custom_${crypto.randomUUID()}`;

/** Every built-in and custom theme as a card; pick, duplicate, edit or add one. */
export function ThemeGallery({ settings, applySettings }: Props) {
  const { t } = useTranslation();
  const presetId = settings.theme_preset ?? DEFAULT_PRESET_ID;
  const variant = activeVariant(settings.theme, prefersDarkScheme());
  const customs = settings.custom_presets ?? [];
  const [edit, setEdit] = useState<EditState>(null);

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

  // Confirmation is handled in the editor's own dialog before this runs.
  const deleteCustom = (id: string) => {
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

  return (
    <>
      <div className="theme-gallery">
        {cards.map(c => (
          <div className={`theme-card ${presetId === c.id ? "active" : ""}`} key={c.id}>
            <button type="button" className="theme-card-select" aria-pressed={presetId === c.id} onClick={() => select(c.id)}>
              <span className="theme-palette" aria-hidden="true">
                <span className="theme-palette-row" data-variant={variant}>
                  {PREVIEW_TOKENS.map(tk => (
                    <span key={tk} className="theme-palette-swatch" style={{ background: c[variant][tk] }} />
                  ))}
                </span>
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
            </div>
          </div>
        ))}
        <button type="button" className="theme-card theme-card-new" onClick={startNew}>
          <span className="theme-card-new-plus" aria-hidden="true">+</span>
          <span className="theme-card-name">{t("settings.themeNewPreset")}</span>
        </button>
      </div>

      {edit && (
        <ThemeEditorModal
          preset={edit.preset}
          initialTab={variant}
          onSave={saveEdit}
          onClose={() => setEdit(null)}
          onDelete={edit.existing ? () => deleteCustom(edit.preset.id) : undefined}
        />
      )}
    </>
  );
}
