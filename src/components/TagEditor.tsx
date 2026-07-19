import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { api, Settings, Tag } from "../lib/tauri";
import { errorMessage } from "../lib/errors";
import { clampWeight, readableTextColor } from "../lib/tags";
import { defaultTagColor, defaultTagPriority } from "../lib/settings";
import { ColorPicker } from "./ColorPicker";

type Props = {
  /** The tag to edit; omit (or null) to create a new one. */
  tag?: Tag | null;
  /** Device settings, used to seed a new tag's color/weight defaults (#79). */
  settings?: Settings;
  onClose: () => void;
  /** Called instead of onClose after a successful delete (falls back to onClose). */
  onDeleted?: () => void;
};

type Form = { name: string; color: string; weight: string; pinned: boolean };

export function TagEditor({ tag, settings, onClose, onDeleted }: Props) {
  const { t } = useTranslation();
  const isEdit = !!tag;
  const initialRef = useRef<Form>({
    name: tag?.name ?? "",
    color: tag?.color ?? defaultTagColor(settings),
    weight: tag ? String(tag.priority) : String(defaultTagPriority(settings)),
    // Tags start unpinned; the sidebar is an explicitly-curated subset, so a
    // tag joins it only when the user ticks this box or pins it on the Tags
    // screen (#78). This keeps every creation path consistent — tags typed
    // inline as `#tag` are created unpinned too (see quickAdd's resolveTagIds).
    pinned: tag?.pinned ?? false,
  });
  const [form, setForm] = useState<Form>(initialRef.current);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const dialogRef = useRef<HTMLDivElement>(null);
  // The element focused before the modal opened (the triggering button),
  // captured on first render so focus can be restored on close.
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  if (restoreFocusRef.current === null && typeof document !== "undefined") {
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
  }

  const isDirty = () => JSON.stringify(form) !== JSON.stringify(initialRef.current);
  const requestClose = () => {
    if (isDirty() && !window.confirm(t("tagEditor.discardConfirm"))) return;
    onClose();
  };
  // Keep a stable ref to the latest requestClose so the mount-only key handler
  // sees current form state without re-binding (which would restore focus early).
  const requestCloseRef = useRef(requestClose);
  requestCloseRef.current = requestClose;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); requestCloseRef.current(); return; }
      if (e.key !== "Tab") return;
      const root = dialogRef.current;
      if (!root) return;
      const f = root.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (f.length === 0) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey);
    const opener = restoreFocusRef.current;
    return () => {
      window.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, []);

  const set = <K extends keyof Form>(k: K, v: Form[K]) =>
    setForm(f => ({ ...f, [k]: v }));

  const save = async () => {
    const name = form.name.trim();
    if (!name) { setError(t("tagEditor.nameEmpty")); return; }
    setBusy(true);
    try {
      if (tag) {
        await api.updateTag({ id: tag.id, name, color: form.color, priority: clampWeight(form.weight), pinned: form.pinned });
      } else {
        await api.addTag(name, form.color, clampWeight(form.weight), form.pinned);
      }
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!tag) return;
    if (!window.confirm(t("tagEditor.deleteConfirm", { name: tag.name }))) return;
    setBusy(true);
    try {
      await api.deleteTag(tag.id);
      (onDeleted ?? onClose)();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return createPortal(
    <div className="modal-backdrop">
      <div className="task-editor" ref={dialogRef} role="dialog" aria-modal="true"
           aria-label={isEdit ? t("tagEditor.editTitle") : t("tagEditor.addTitle")}
           onClick={e => e.stopPropagation()}>
        <div className="te-header">
          <div className="te-title-actions">
            <h2>{isEdit ? t("tagEditor.editTitle") : t("tagEditor.addTitle")}</h2>
          </div>
          <button type="button" className="te-close" aria-label={t("tagEditor.cancel")}
                  onClick={requestClose} disabled={busy}>✕</button>
        </div>
        <label className="te-field">
          <span>{t("tagEditor.name")}</span>
          <input value={form.name} autoFocus
                 onChange={e => set("name", e.currentTarget.value)} />
        </label>

        <div className="te-field">
          <span>{t("tagEditor.color")}</span>
          <ColorPicker value={form.color} onChange={c => set("color", c)} />
        </div>

        <div className="te-field">
          <span>{t("tagEditor.preview")}</span>
          <div>
            <span className="task-tag" style={{ background: form.color, color: readableTextColor(form.color) }}>
              {form.name.trim() || t("tagEditor.tagPlaceholder")}
            </span>
          </div>
        </div>

        <label className="te-field">
          <span>{t("tagEditor.weight")}</span>
          <input type="number" className="weight-input" value={form.weight}
                 min={-9999} max={9999}
                 onChange={e => set("weight", e.currentTarget.value)} />
        </label>

        <label className="te-field te-checkbox">
          <span>{t("tagEditor.pinToSidebar")}</span>
          <input type="checkbox" checked={form.pinned}
                 onChange={e => set("pinned", e.currentTarget.checked)} />
        </label>

        {error && <p className="composer-error">{error}</p>}

        <div className="te-actions">
          {isEdit && (
            <button type="button" className="te-delete" onClick={remove} disabled={busy}>{t("tagEditor.delete")}</button>
          )}
          <span className="te-spacer" />
          <button type="button" onClick={requestClose} disabled={busy}>{t("tagEditor.cancel")}</button>
          <button type="button" className="te-save" onClick={save}
                  disabled={busy || !form.name.trim()}>{t("tagEditor.save")}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
