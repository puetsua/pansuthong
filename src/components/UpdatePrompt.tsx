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

/**
 * Auto-checks for a newer release once on mount (desktop only — see
 * {@link checkForUpdate}) and, if one exists, shows a modal with the version and
 * release notes. "Update now" downloads/installs with a progress bar and
 * relaunches; "Later" / ✕ / Escape dismisses until the next launch. Renders
 * nothing when no update is pending, so it's safe to mount unconditionally.
 *
 * Shell matches other editors: `.task-editor` card, `.te-header` + close, and
 * `.te-actions` / `.te-save` for the footer (not a one-off `.upd-dialog`).
 */
export function UpdatePrompt() {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase | null>(null);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  useEffect(() => {
    let active = true;
    void checkForUpdate().then(update => {
      if (active && update) setPhase({ kind: "available", update });
    });
    return () => {
      active = false;
    };
  }, []);

  // Escape dismisses like TaskEditor / TagEditor, but not mid-download.
  useEffect(() => {
    if (!phase) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (phaseRef.current?.kind === "downloading") return;
      e.preventDefault();
      setPhase(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase]);

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
            aria-label={t("titlebar.close")}
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
            <button type="button" className="te-save" onClick={() => void install()}>
              {phase.kind === "error" ? t("update.retry") : t("update.now")}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
