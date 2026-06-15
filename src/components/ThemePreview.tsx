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
      <div className="theme-preview-surface" data-token="--c-surface">
        <div className="theme-preview-title" data-token="--c-text">{t("settings.themePreviewTitle")}</div>
        <div className="theme-preview-muted" data-token="--c-text-muted">{t("settings.themePreviewBody")}</div>
        <div className="theme-preview-row">
          <button type="button" tabIndex={-1} className="theme-preview-accent" data-token="--c-accent">
            {t("settings.themePreviewAction")}
          </button>
          <span className="theme-preview-chip" data-token="--c-accent-bg">{t("settings.themePreviewTag")}</span>
          <span className="theme-preview-subtle" data-token="--c-text-subtle">{t("settings.themePreviewSubtle")}</span>
        </div>
        <div className="theme-preview-row">
          <span className="theme-preview-dot danger" data-token="--c-danger" />
          <span className="theme-preview-dot success" data-token="--c-success" />
          <span className="theme-preview-raised" data-token="--c-surface-2">{t("settings.themePreviewRaised")}</span>
        </div>
      </div>
    </div>
  );
}
