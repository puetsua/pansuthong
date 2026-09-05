import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Indexes } from "../state/indexes";
import { AppVersionRow } from "./AppVersionRow";

type Props = { indexes: Indexes };

const ROUTE_TITLE_KEYS: Record<string, string> = {
  "/today":    "nav.today",
  "/inbox":    "nav.inbox",
  "/upcoming": "nav.upcoming",
  "/calendar":  "nav.calendar",
  "/search":   "nav.search",
  "/templates": "nav.templates",
  "/dashboard": "nav.dashboard",
  "/history": "nav.history",
  "/tags":     "nav.tags",
  "/archived": "nav.archived",
  "/settings": "nav.settings",
};

// Secondary destinations live in the "More" menu so the header stays two
// buttons wide on a phone; primary views are the bottom tabs. Text-only —
// glyph icons competed with labels on a dense phone menu.
const MENU_ITEMS = [
  { to: "/upcoming",   labelKey: "nav.upcoming" },
  { to: "/templates",  labelKey: "nav.templates" },
  { to: "/dashboard", labelKey: "nav.dashboard" },
  { to: "/history",    labelKey: "nav.history" },
  { to: "/tags",       labelKey: "nav.tags" },
  { to: "/archived",   labelKey: "nav.archived" },
  { to: "/settings",   labelKey: "nav.settings" },
] as const;

export function MobileHeader({ indexes }: Props) {
  const { t } = useTranslation();
  const loc = useLocation();
  const title = pickTitle(loc.pathname, indexes, t);
  const [menuOpen, setMenuOpen] = useState(false);

  // Navigating (via a menu item or anything else) always dismisses the menu.
  useEffect(() => { setMenuOpen(false); }, [loc.pathname]);

  return (
    <header className="mobile-header">
      <h1 className="mobile-title">{title}</h1>
      <div className="mobile-header-actions">
        <Link to="/search" className="mobile-header-icon" aria-label={t("nav.search")}>⌕</Link>
        <button
          type="button"
          className="mobile-header-icon mobile-header-more"
          aria-label={t("nav.more")}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(open => !open)}
        >⋯</button>
      </div>
      {menuOpen && (
        <>
          <div className="mobile-menu-backdrop" onClick={() => setMenuOpen(false)} />
          <nav className="mobile-menu" role="menu" aria-label={t("nav.more")}>
            {MENU_ITEMS.map(item => (
              <Link key={item.to} to={item.to} role="menuitem" className="mobile-menu-item">
                {t(item.labelKey)}
              </Link>
            ))}
            {/* Same version/update footer as the desktop sidebar; Android has
                no sidebar, so this is the only place the running build shows. */}
            <AppVersionRow className="mobile-menu-version" />
          </nav>
        </>
      )}
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
