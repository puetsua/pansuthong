import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Indexes } from "../state/indexes";
import { MenuIcon } from "../components/NavIcons";
import { openSettingsDrawer } from "../lib/settingsRoute";

type Props = { indexes: Indexes };

const ROUTE_TITLE_KEYS: Record<string, string> = {
  "/today":    "nav.today",
  "/inbox":    "nav.inbox",
  "/calendar":  "nav.calendar",
  "/search":   "nav.search",
  "/templates": "nav.templates",
  "/dashboard": "nav.dashboard",
  "/history": "nav.history",
  "/tags":     "nav.tags",
  "/archived": "nav.archived",
  "/settings": "nav.settings",
};

// Task lists where jumping to search makes sense.
const SEARCHABLE = ["/today", "/inbox", "/calendar"];

export function MobileHeader({ indexes }: Props) {
  const { t } = useTranslation();
  const loc = useLocation();
  const title = pickTitle(loc.pathname, indexes, t);

  const onSettings = loc.pathname === "/settings";
  const showSearch = SEARCHABLE.some(p => loc.pathname === p) || loc.pathname.startsWith("/tag/");

  // The header names the page (pages hide their own h1 on a phone); the More
  // menu lives in the bottom tabs. Search only shows on task lists it can
  // search; Settings has a ☰ that opens its category drawer instead.
  return (
    <header className="mobile-header">
      <div className="mobile-title-row">
        {onSettings && (
          <button
            type="button"
            className="mobile-header-icon mobile-header-menu"
            aria-label={t("settings.groups.navLabel")}
            aria-haspopup="true"
            onClick={openSettingsDrawer}
          >
            <MenuIcon size={22} />
          </button>
        )}
        <h1 className="mobile-title">{title}</h1>
      </div>
      {showSearch && (
        <div className="mobile-header-actions">
          <Link to="/search" className="mobile-header-icon" aria-label={t("nav.search")}>⌕</Link>
        </div>
      )}
    </header>
  );
}

function pickTitle(pathname: string, indexes: Indexes, t: TFunction): string {
  if (ROUTE_TITLE_KEYS[pathname]) return t(ROUTE_TITLE_KEYS[pathname]);
  const tagMatch = pathname.match(/^\/tag\/(.+)$/);
  if (tagMatch) {
    const tag = indexes.tagsById.get(tagMatch[1]);
    return tag ? tag.name : t("nav.tag");
  }
  if (pathname.startsWith("/conflicts/")) return t("nav.conflict");
  return t("nav.appName");
}
