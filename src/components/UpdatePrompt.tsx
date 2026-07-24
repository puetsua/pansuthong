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
 * Keyboard/focus matches TaskEditor: Tab cycle, Escape (capture, so a stacked
 * editor underneath does not also close), `#root` inert, restore focus on close.
 */
export function UpdatePrompt() {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase | null>(null);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const open = phase != null;

  useEffect(() => {
    let active = true;
    void checkForUpdate().then(update => {
      if (active && update) setPhase({ kind: "available", update });
    });
    return () => {
      active = false;
    };
  }, []);

  // Mount-only-while-open: Escape/Tab + inert background, like TaskEditor.
  // Depends on `open` (not `phase`) so download progress does not rebind.
  useEffect(() => {
    if (!open) return;
    if (restoreFocusRef.current === null) {
      restoreFocusRef.current = document.activeElement as HTMLElement | null;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Capture + stop so an editor open underneath does not also dismiss.
        if (phaseRef.current?.kind === "downloading") return;
        e.preventDefault();
        e.stopPropagation();
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
    const appRoot = document.getElementById("root");
    appRoot?.setAttribute("inert", "");
    appRoot?.setAttribute("aria-hidden", "true");
    const opener = restoreFocusRef.current;
    return () => {
      window.removeEventListener("keydown", onKey, true);
      appRoot?.removeAttribute("inert");
      appRoot?.removeAttribute("aria-hidden");
      opener?.focus?.();
      restoreFocusRef.current = null;
    };
  }, [open]);

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
          <div className="upd-progress" role="status">
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
