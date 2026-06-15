import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import type { ThemePreset } from "../lib/tauri";
import { TOKEN_ORDER, TOKEN_LABEL_KEY, ThemeVariant, serializeThemeJson, parseThemeJson } from "../lib/themes";

type Props = {
  /** Working copy to edit (full light + dark token maps). Its id is preserved. */
  preset: ThemePreset;
  onSave: (preset: ThemePreset) => void;
  onClose: () => void;
  /** When provided, an existing custom preset is being edited and Delete is shown. */
  onDelete?: () => void;
  /** Which variant tab to open on (defaults to light). */
  initialTab?: ThemeVariant;
};

const HEX6 = /^#[0-9a-f]{6}$/i;
const HEX3 = /^#[0-9a-f]{3}$/i;

/** Normalize a token value to a 6-digit hex the native color input accepts;
 *  expands #abc and falls back to black for an incomplete value being typed. */
function toColorValue(v: string | undefined): string {
  if (!v) return "#000000";
  if (HEX6.test(v)) return v;
  if (HEX3.test(v)) return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
  return "#000000";
}

export function ThemeEditorModal({ preset, onSave, onClose, onDelete, initialTab = "light" }: Props) {
  const { t } = useTranslation();
  const [name, setName] = useState(preset.name);
  const [light, setLight] = useState<Record<string, string>>({ ...preset.light });
  const [dark, setDark] = useState<Record<string, string>>({ ...preset.dark });
  const [tab, setTab] = useState<ThemeVariant>(initialTab);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [importText, setImportText] = useState("");
  const [importErr, setImportErr] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  if (restoreFocusRef.current === null && typeof document !== "undefined") {
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
  }
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); closeRef.current(); }
    };
    window.addEventListener("keydown", onKey);
    const opener = restoreFocusRef.current;
    return () => { window.removeEventListener("keydown", onKey); opener?.focus?.(); };
  }, []);

  const tokens = tab === "light" ? light : dark;
  const setToken = (token: string, value: string) => {
    const update = (m: Record<string, string>) => ({ ...m, [token]: value });
    if (tab === "light") setLight(update); else setDark(update);
  };

  const json = serializeThemeJson(name.trim() || preset.name, light, dark);

  const save = () => {
    const trimmed = name.trim();
    if (!trimmed) { setError(t("settings.themeNameEmpty")); return; }
    onSave({ id: preset.id, name: trimmed, light, dark });
  };

  const copy = () => {
    void navigator.clipboard?.writeText(json).then(
      () => { setCopied(true); setTimeout(() => setCopied(false), 1500); },
      () => {},
    );
  };

  // Import a pasted theme into the editor's working fields (merged over the current
  // tokens so every token still has a value); the user reviews then Saves.
  const doImport = () => {
    try {
      const parsed = parseThemeJson(importText);
      setName(parsed.name);
      setLight(prev => ({ ...prev, ...parsed.light }));
      setDark(prev => ({ ...prev, ...parsed.dark }));
      setImportText("");
      setImportErr(null);
    } catch (e) {
      setImportErr(t((e as Error).message));
    }
  };

  return createPortal(
    <div className="modal-backdrop">
      <div className="task-editor theme-editor" ref={dialogRef} role="dialog" aria-modal="true"
           aria-label={onDelete ? t("settings.themeEditTitle") : t("settings.themeNewTitle")}
           onClick={e => e.stopPropagation()}>
        <label className="te-field">
          <span>{t("settings.themeName")}</span>
          <input value={name} autoFocus placeholder={t("settings.themeNamePlaceholder")}
                 onChange={e => setName(e.currentTarget.value)} />
        </label>

        <div className="theme-tabs" role="tablist">
          {(["light", "dark"] as const).map(v => (
            <button key={v} type="button" role="tab" aria-selected={tab === v}
                    className={`theme-tab ${tab === v ? "active" : ""}`}
                    onClick={() => setTab(v)}>
              {t(v === "light" ? "settings.themeLightGroup" : "settings.themeDarkGroup")}
            </button>
          ))}
        </div>

        <div className="theme-token-rows">
          {TOKEN_ORDER.map(token => {
            const label = t(TOKEN_LABEL_KEY[token]);
            return (
              <div className="theme-token-row" key={token}>
                <span className="theme-token-label">{label}</span>
                <input type="color" aria-label={label}
                       value={toColorValue(tokens[token])}
                       onChange={e => setToken(token, e.currentTarget.value)} />
                <input type="text" className="theme-token-hex" aria-label={`${label} hex`}
                       value={tokens[token] ?? ""} spellCheck={false}
                       onChange={e => setToken(token, e.currentTarget.value)} />
              </div>
            );
          })}
        </div>

        <details className="theme-collapse">
          <summary>{t("settings.themeImport")}</summary>
          <textarea className="theme-json" aria-label={t("settings.themeImport")}
                    placeholder={t("settings.themeImportPlaceholder")} rows={4}
                    value={importText}
                    onChange={e => { setImportText(e.currentTarget.value); setImportErr(null); }} />
          {importErr && <p className="composer-error" role="alert">{importErr}</p>}
          <button type="button" className="theme-option" onClick={doImport} disabled={!importText.trim()}>
            {t("settings.themeImportButton")}
          </button>
        </details>

        <details className="theme-collapse">
          <summary>{t("settings.themeExport")}</summary>
          <textarea className="theme-json" readOnly aria-label={t("settings.themeExportJsonLabel")}
                    rows={6} value={json} onFocus={e => e.currentTarget.select()} />
          <button type="button" className="theme-option" onClick={copy}>
            {copied ? t("settings.themeCopied") : t("settings.themeCopyJson")}
          </button>
        </details>

        {error && <p className="composer-error">{error}</p>}

        <div className="te-actions">
          {onDelete && (
            <button type="button" className="te-delete" onClick={() => setConfirmingDelete(true)}>{t("settings.themeDelete")}</button>
          )}
          <span className="te-spacer" />
          <button type="button" onClick={onClose}>{t("settings.themeCancel")}</button>
          <button type="button" className="te-save" onClick={save} disabled={!name.trim()}>
            {t("settings.themeSave")}
          </button>
        </div>
      </div>

      {confirmingDelete && onDelete && (
        <div className="modal-backdrop theme-confirm-backdrop">
          <div className="task-editor theme-confirm" role="alertdialog" aria-modal="true"
               aria-label={t("settings.themeDelete")} onClick={e => e.stopPropagation()}>
            <p>{t("settings.themeDeleteConfirm", { name: name.trim() || preset.name })}</p>
            <div className="te-actions">
              <span className="te-spacer" />
              <button type="button" onClick={() => setConfirmingDelete(false)}>{t("settings.themeCancel")}</button>
              <button type="button" className="te-delete" onClick={() => { setConfirmingDelete(false); onDelete(); }}>
                {t("settings.themeDelete")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
