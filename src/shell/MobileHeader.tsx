import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Indexes } from "../state/indexes";

type Props = { indexes: Indexes };

const ROUTE_TITLE_KEYS: Record<string, string> = {
  "/today":    "nav.today",
  "/inbox":    "nav.inbox",
  "/upcoming": "nav.upcoming",
  "/search":   "nav.search",
  "/templates": "nav.templates",
  "/recurrence": "nav.recurrence",
  "/history": "nav.history",
  "/tags":     "nav.tags",
  "/archived": "nav.archived",
  "/settings": "nav.settings",
};

// Secondary destinations live in the "More" menu so the header stays two
// buttons wide on a phone; primary views are the bottom tabs.
const MENU_ITEMS = [
  { to: "/templates",  labelKey: "nav.templates",  icon: "▤" },
  { to: "/recurrence", labelKey: "nav.recurrence", icon: "▦" },
  { to: "/history",    labelKey: "nav.history",    icon: "◷" },
  { to: "/tags",       labelKey: "nav.tags",       icon: "#" },
  { to: "/archived",   labelKey: "nav.archived",   icon: "▣" },
  { to: "/settings",   labelKey: "nav.settings",   icon: "⚙" },
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
                <span className="mobile-menu-icon" aria-hidden>{item.icon}</span>
                {t(item.labelKey)}
              </Link>
            ))}
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
