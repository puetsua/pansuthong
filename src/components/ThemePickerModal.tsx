import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import type { Settings, ThemePreset } from "../lib/tauri";
import {
  THEME_PRESETS, DEFAULT_PRESET_ID, ThemeTokens,
  fullTokens, serializeThemeJson, activeVariant, prefersDarkScheme, type ThemeSettingsPatch,
} from "../lib/themes";
import { ThemeEditorModal } from "./ThemeEditorModal";

type Props = {
  settings: Settings;
  applySettings: (patch: ThemeSettingsPatch) => void;
  onClose: () => void;
};

// Representative tokens shown in a card's palette preview.
const PREVIEW_TOKENS = ["--c-bg", "--c-surface", "--c-accent", "--c-text"] as const;

type Card = { id: string; name: string; light: ThemeTokens; dark: ThemeTokens; custom: boolean };
type EditState = { preset: ThemePreset; existing: boolean } | null;

const base = THEME_PRESETS[0];
const newId = () => `custom_${crypto.randomUUID()}`;

export function ThemePickerModal({ settings, applySettings, onClose }: Props) {
  const { t } = useTranslation();
  const presetId = settings.theme_preset ?? DEFAULT_PRESET_ID;
  const variant = activeVariant(settings.theme, prefersDarkScheme());
  const customs = settings.custom_presets ?? [];
  const [edit, setEdit] = useState<EditState>(null);

  const restoreFocusRef = useRef<HTMLElement | null>(null);
  if (restoreFocusRef.current === null && typeof document !== "undefined") {
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
  }
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Let the editor (if open) handle Escape itself; only close the picker when
      // it's the topmost dialog.
      if (e.key === "Escape" && !document.querySelector(".theme-editor")) {
        e.preventDefault(); closeRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    const opener = restoreFocusRef.current;
    return () => { window.removeEventListener("keydown", onKey); opener?.focus?.(); };
  }, []);

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

  return createPortal(
    <div className="modal-backdrop">
      <div className="task-editor theme-picker" role="dialog" aria-modal="true"
           aria-label={t("settings.themePickerTitle")} onClick={e => e.stopPropagation()}>
        <h2 className="theme-picker-title">{t("settings.themePickerTitle")}</h2>

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
          <button type="button" className="theme-card theme-card-new" onClick={startNew}>
            <span className="theme-card-new-plus" aria-hidden="true">+</span>
            <span className="theme-card-name">{t("settings.themeNewPreset")}</span>
          </button>
        </div>

        <div className="te-actions">
          <span className="te-spacer" />
          <button type="button" className="te-save" onClick={onClose}>{t("settings.themeDone")}</button>
        </div>
      </div>

      {edit && (
        <ThemeEditorModal
          preset={edit.preset}
          onSave={saveEdit}
          onClose={() => setEdit(null)}
          onDelete={edit.existing ? () => deleteCustom(edit.preset.id, edit.preset.name) : undefined}
        />
      )}
    </div>,
    document.body,
  );
}
