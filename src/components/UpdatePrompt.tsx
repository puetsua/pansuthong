import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import type { Update } from "@tauri-apps/plugin-updater";
import { checkForUpdate, installUpdate } from "../lib/updater";

type Phase =
  | { kind: "available"; update: Update }
  | { kind: "downloading"; update: Update; fraction: number }
  | { kind: "error"; update: Update; message: string };

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Auto-checks for a newer release once on mount (desktop only — see
 * {@link checkForUpdate}) and, if one exists, shows a modal with the version and
 * release notes. "Update now" downloads/installs with a progress bar and
 * relaunches; "Later" / ✕ / Escape dismisses until the next launch. Renders
 * nothing when no update is pending, so it's safe to mount unconditionally.
 *
 * Shell matches other editors: `.task-editor` card, `.te-header` + close, and
 * `.te-actions` / `.te-save` for the footer (not a one-off `.upd-dialog`).
 * Keyboard/focus matches other modals: Tab cycle, Escape (capture, so a stacked
 * editor underneath does not also close), restore focus on close. `#root` inert
 * stays TaskEditor-only — toggling it here races other dialogs.
 */
export function UpdatePrompt() {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase | null>(null);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const open = phase != null;

  // Capture the pre-dialog focus during render (before autoFocus commits), same
  // timing as TaskEditor — an effect would already see the autofocused button.
  if (open && restoreFocusRef.current === null && typeof document !== "undefined") {
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
  }

  useEffect(() => {
    let active = true;
    void checkForUpdate().then(update => {
      if (active && update) setPhase({ kind: "available", update });
    });
    return () => {
      active = false;
    };
  }, []);

  // Mount-only-while-open: Escape/Tab like TaskEditor. Do not toggle `#root`
  // inert — only TaskEditor owns that, and clearing it here would either strip
  // an open editor's inert or leave TagEditor/theme modals stuck non-interactive.
  // Depends on `open` (not `phase`) so download progress does not rebind.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Always own Escape while open so a stacked editor does not also close,
        // including mid-download (dismiss is skipped; propagation still stops).
        e.preventDefault();
        e.stopPropagation();
        if (phaseRef.current?.kind === "downloading") return;
        setPhase(null);
        return;
      }
      if (e.key !== "Tab") return;
      const root = dialogRef.current;
      if (!root) return;
      const f = root.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (f.length === 0) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey, true);
    const opener = restoreFocusRef.current;
    return () => {
      window.removeEventListener("keydown", onKey, true);
      // Keep restoreFocusRef (TaskEditor pattern) so StrictMode remount still
      // restores the pre-dialog control on real dismiss.
      opener?.focus?.();
    };
  }, [open]);

  // While downloading, actions unmount and Close is disabled — park focus on the
  // status region so Tab cannot leak into the app behind an undismissable prompt.
  useEffect(() => {
    if (phase?.kind !== "downloading") return;
    dialogRef.current?.querySelector<HTMLElement>(".upd-progress")?.focus();
  }, [phase?.kind]);

  if (!phase) return null;

  const { update } = phase;
  const downloading = phase.kind === "downloading";

  async function install() {
    setPhase({ kind: "downloading", update, fraction: 0 });
    try {
      await installUpdate(update, fraction =>
        setPhase({ kind: "downloading", update, fraction }),
      );
      // installUpdate relaunches on success, so we don't expect to get here.
    } catch (e) {
      setPhase({ kind: "error", update, message: String(e) });
    }
  }

  const dismiss = () => {
    if (!downloading) setPhase(null);
  };

  return createPortal(
    <div className="modal-backdrop">
      <div
        className="task-editor upd-prompt"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="upd-title"
        onClick={e => e.stopPropagation()}
      >
        <div className="te-header">
          <div className="te-title-actions">
            <h2 id="upd-title">{t("update.title", { version: update.version })}</h2>
          </div>
          <button
            type="button"
            className="te-close"
            aria-label={t("update.close")}
            onClick={dismiss}
            disabled={downloading}
          >
            ✕
          </button>
        </div>

        {update.body && (
          <div className="te-notes-preview upd-notes">
            <ReactMarkdown>{update.body}</ReactMarkdown>
          </div>
        )}

        {phase.kind === "error" && (
          <p className="composer-error" role="alert">
            {t("update.failed", { error: phase.message })}
          </p>
        )}

        {downloading ? (
          <div className="upd-progress" role="status" tabIndex={0}>
            <div className="upd-progress-track">
              <div
                className="upd-progress-bar"
                style={{ width: `${Math.round(phase.fraction * 100)}%` }}
              />
            </div>
            <span>{t("update.downloading")}</span>
          </div>
        ) : (
          <div className="te-actions">
            <span className="te-spacer" />
            <button type="button" onClick={dismiss}>
              {t("update.later")}
            </button>
            <button type="button" className="te-save" autoFocus onClick={() => void install()}>
              {phase.kind === "error" ? t("update.retry") : t("update.now")}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
