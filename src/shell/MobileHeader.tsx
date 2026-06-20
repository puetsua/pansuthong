import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Indexes } from "../state/indexes";

type Props = { indexes: Indexes };

const ROUTE_TITLE_KEYS: Record<string, string> = {
  "/today":    "nav.today",
  "/inbox":    "nav.inbox",
  "/upcoming": "nav.upcoming",
  "/templates": "nav.templates",
  "/recurrence": "nav.recurrence",
  "/history": "nav.history",
  "/tags":     "nav.tags",
  "/archived": "nav.archived",
  "/settings": "nav.settings",
};

export function MobileHeader({ indexes }: Props) {
  const { t } = useTranslation();
  const loc = useLocation();
  const title = pickTitle(loc.pathname, indexes, t);

  return (
    <header className="mobile-header">
      <h1 className="mobile-title">{title}</h1>
      <div className="mobile-header-actions">
        <Link to="/templates" className="mobile-header-icon" aria-label={t("nav.templates")}>▤</Link>
        <Link to="/recurrence" className="mobile-header-icon" aria-label={t("nav.recurrence")}>▦</Link>
        <Link to="/history" className="mobile-header-icon" aria-label={t("nav.history")}>H</Link>
        <Link to="/tags" className="mobile-header-icon" aria-label={t("nav.tags")}>#</Link>
        <Link to="/settings" className="mobile-header-icon" aria-label={t("nav.settings")}>⚙</Link>
      </div>
    </header>
  );
}

function pickTitle(pathname: string, indexes: Indexes, t: TFunction): string {
  if (ROUTE_TITLE_KEYS[pathname]) return t(ROUTE_TITLE_KEYS[pathname]);
  const tagMatch = pathname.match(/^\/tag\/(.+)$/);
  if (tagMatch) {
    const tag = indexes.tagsById.get(tagMatch[1]);
    return tag ? `#${tag.name}` : t("nav.tag");
  }
  if (pathname.startsWith("/conflicts/")) return t("nav.conflict");
  return t("nav.appName");
}
