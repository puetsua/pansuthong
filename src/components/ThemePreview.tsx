import { type CSSProperties, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { TOKEN_ORDER, type ThemeTokens } from "../lib/themes";

type Props = {
  tokens: ThemeTokens;
  /** Called with the token under the pointer (the nearest element carrying one),
   *  or null on leave, so the editor can highlight that color's row. */
  onHover?: (token: string | null) => void;
};

/** A small mock UI rendered with the given token map applied as inline CSS
 *  variables, so the theme editor can show colors live as they're edited (#15).
 *  Hover is resolved by delegation: whichever `[data-token]` element is under the
 *  pointer wins, so there are no gaps as the pointer moves between elements. */
export function ThemePreview({ tokens, onHover }: Props) {
  const { t } = useTranslation();
  const style: CSSProperties = {};
  for (const tok of TOKEN_ORDER) {
    if (tokens[tok]) (style as Record<string, string>)[tok] = tokens[tok];
  }
  const heatmapStyle = {
    "--heat-cell": "1.05rem",
    display: "flex",
    gap: "2px",
    marginTop: "var(--space-3)",
  } as CSSProperties;

  const handleOver = onHover
    ? (e: MouseEvent<HTMLDivElement>) => {
        const el = (e.target as HTMLElement).closest("[data-token]");
        onHover(el?.getAttribute("data-token") ?? null);
      }
    : undefined;
  const handleLeave = onHover ? () => onHover(null) : undefined;

  return (
    <div className="theme-preview" style={style} aria-hidden="true" data-token="--c-bg"
         onMouseOver={handleOver} onMouseLeave={handleLeave}>
      <div className="theme-preview-app">
        <div className="theme-preview-sidebar" data-token="--c-surface-2">
          <span className="tp-nav tp-nav-active" data-token="--c-accent-bg">{t("nav.today")}</span>
          <span className="tp-nav" data-token="--c-text-muted">{t("nav.inbox")}</span>
          <span className="tp-nav" data-token="--c-text-muted">{t("nav.upcoming")}</span>
        </div>
        <div className="theme-preview-main">
          {/* A normal task row */}
          <div className="task-row" data-token="--c-surface">
            <span className="task-main">
              <span className="task-title"><span className="tp-text" data-token="--c-text">{t("settings.themePreviewTitle")}</span></span>
              <span className="task-when late" data-token="--c-danger">{t("settings.themePreviewOverdue")}</span>
            </span>
            <span className="task-timer" data-token="--c-text-muted">
              <span className="task-timer-icon" aria-hidden>▶</span>
            </span>
            <span className="tp-check" data-token="--c-border" />
          </div>
          {/* A running-timer task row */}
          <div className="task-row" data-timing="true" data-token="--c-accent-bg">
            <span className="task-main">
              <span className="task-title"><span className="tp-text" data-token="--c-text">{t("settings.themePreviewTask2")}</span></span>
              <span className="task-when" data-token="--c-text-subtle"
                    style={{ color: "var(--c-text-subtle)" }}>{t("settings.themePreviewTimeLeft")}</span>
            </span>
            <span className="task-timer" data-running="true" data-token="--c-accent">
              <span className="task-timer-icon" aria-hidden>■</span>
              <span className="task-timer-time">12:30</span>
            </span>
            <span className="tp-check" data-token="--c-border" />
            <div className="task-row-progress"><div className="task-row-progress-fill" style={{ width: "60%" }} /></div>
          </div>
          {/* Simple heatmap preview — bare cells, no text (#15). */}
          <div className="theme-preview-heatmap" data-token="--c-heat-border" style={heatmapStyle}>
            <span className="heatmap-cell heatmap-done" data-token="--c-heat-done" />
            <span className="heatmap-cell heatmap-skip" data-token="--c-heat-skip" />
            <span className="heatmap-cell heatmap-none" data-token="--c-heat-empty" />
            <span className="heatmap-cell heatmap-done heatmap-today" data-token="--c-heat-today" />
          </div>
        </div>
      </div>
    </div>
  );
}
