import { useEffect, useRef } from "react";

/** In-app confirmation modal with a red confirm button. Esc cancels. */
export function ConfirmDialog({ message, confirmLabel, cancelLabel, onConfirm, onCancel }: {
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onCancel(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onCancel]);
  return (
    <div className="te-confirm" role="dialog" aria-modal="true" aria-label={message} onClick={onCancel}>
      <div className="te-confirm-box" onClick={e => e.stopPropagation()}>
        <p>{message}</p>
        <div className="te-confirm-actions">
          <button type="button" onClick={onCancel}>{cancelLabel}</button>
          <button type="button" ref={confirmRef} className="te-confirm-delete" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/** "Save before closing?" prompt. Save is auto-focused so Enter saves. */
export function SaveChangesDialog({ message, saveLabel, discardLabel, cancelLabel, onSave, onDiscard, onCancel }: {
  message: string;
  saveLabel: string;
  discardLabel: string;
  cancelLabel: string;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}) {
  const saveRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    saveRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onCancel(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onCancel]);
  return (
    <div className="te-confirm" role="dialog" aria-modal="true" aria-label={message} onClick={onCancel}>
      <div className="te-confirm-box" onClick={e => e.stopPropagation()}>
        <p>{message}</p>
        <div className="te-confirm-actions">
          <button type="button" onClick={onDiscard}>{discardLabel}</button>
          <button type="button" onClick={onCancel}>{cancelLabel}</button>
          <button type="button" ref={saveRef} className="te-save" onClick={onSave}>
            {saveLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
