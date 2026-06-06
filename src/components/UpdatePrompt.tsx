import { useEffect, useState } from "react";
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
 * relaunches; "Later" dismisses until the next launch. Renders nothing when no
 * update is pending, so it's safe to mount unconditionally.
 */
export function UpdatePrompt() {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase | null>(null);

  useEffect(() => {
    let active = true;
    void checkForUpdate().then(update => {
      if (active && update) setPhase({ kind: "available", update });
    });
    return () => {
      active = false;
    };
  }, []);

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

  return createPortal(
    <div className="modal-backdrop">
      <div className="upd-dialog" role="dialog" aria-modal="true" aria-labelledby="upd-title">
        <h2 id="upd-title" className="upd-title">
          {t("update.title", { version: update.version })}
        </h2>
        {update.body && (
          <div className="upd-notes">
            <ReactMarkdown>{update.body}</ReactMarkdown>
          </div>
        )}

        {phase.kind === "error" && (
          <p className="composer-error">{t("update.failed", { error: phase.message })}</p>
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
          <div className="upd-actions">
            <button type="button" onClick={() => setPhase(null)}>
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
