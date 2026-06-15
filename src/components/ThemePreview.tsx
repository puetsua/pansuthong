import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { TOKEN_ORDER, type ThemeTokens } from "../lib/themes";

type Props = {
  tokens: ThemeTokens;
  /** Called with the token a hovered element maps to (or null on leave), so the
   *  editor can highlight that color's row. */
  onHover?: (token: string | null) => void;
};

/** A small mock UI rendered with the given token map applied as inline CSS
 *  variables, so the theme editor can show colors live as they're edited (#15).
 *  Hovering an element reports the token it primarily uses via `onHover`. */
export function ThemePreview({ tokens, onHover }: Props) {
  const { t } = useTranslation();
  const style: CSSProperties = {};
  for (const tok of TOKEN_ORDER) {
    if (tokens[tok]) (style as Record<string, string>)[tok] = tokens[tok];
  }

  // Spread onto an element to make it report its primary token on hover.
  const hov = (token: string) => ({
    "data-token": token,
    onMouseEnter: () => onHover?.(token),
    onMouseLeave: () => onHover?.(null),
  });

  return (
    <div className="theme-preview" style={style} aria-hidden="true" {...hov("--c-bg")}>
      <div className="theme-preview-surface" {...hov("--c-surface")}>
        <div className="theme-preview-title" {...hov("--c-text")}>{t("settings.themePreviewTitle")}</div>
        <div className="theme-preview-muted" {...hov("--c-text-muted")}>{t("settings.themePreviewBody")}</div>
        <div className="theme-preview-row">
          <button type="button" tabIndex={-1} className="theme-preview-accent" {...hov("--c-accent")}>
            {t("settings.themePreviewAction")}
          </button>
          <span className="theme-preview-chip" {...hov("--c-accent-bg")}>{t("settings.themePreviewTag")}</span>
          <span className="theme-preview-subtle" {...hov("--c-text-subtle")}>{t("settings.themePreviewSubtle")}</span>
        </div>
        <div className="theme-preview-row">
          <span className="theme-preview-dot danger" {...hov("--c-danger")} />
          <span className="theme-preview-dot success" {...hov("--c-success")} />
          <span className="theme-preview-raised" {...hov("--c-surface-2")}>{t("settings.themePreviewRaised")}</span>
        </div>
      </div>
    </div>
  );
}
