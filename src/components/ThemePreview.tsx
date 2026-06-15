import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { TOKEN_ORDER, type ThemeTokens } from "../lib/themes";

type Props = { tokens: ThemeTokens };

/** A small mock UI rendered with the given token map applied as inline CSS
 *  variables, so the theme editor can show colors live as they're edited (#15). */
export function ThemePreview({ tokens }: Props) {
  const { t } = useTranslation();
  const style: CSSProperties = {};
  for (const tok of TOKEN_ORDER) {
    if (tokens[tok]) (style as Record<string, string>)[tok] = tokens[tok];
  }

  return (
    <div className="theme-preview" style={style} aria-hidden="true">
      <div className="theme-preview-surface">
        <div className="theme-preview-title">{t("settings.themePreviewTitle")}</div>
        <div className="theme-preview-muted">{t("settings.themePreviewBody")}</div>
        <div className="theme-preview-row">
          <button type="button" tabIndex={-1} className="theme-preview-accent">{t("settings.themePreviewAction")}</button>
          <span className="theme-preview-chip">{t("settings.themePreviewTag")}</span>
          <span className="theme-preview-subtle">{t("settings.themePreviewSubtle")}</span>
        </div>
        <div className="theme-preview-row">
          <span className="theme-preview-dot danger" />
          <span className="theme-preview-dot success" />
          <span className="theme-preview-raised">{t("settings.themePreviewRaised")}</span>
        </div>
      </div>
    </div>
  );
}
