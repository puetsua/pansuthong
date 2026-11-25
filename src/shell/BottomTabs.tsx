import { useEffect, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { ComponentType, SVGProps } from "react";
import { Indexes, openCount } from "../state/indexes";
import { InboxIcon, TodayIcon, CalendarIcon, MoreIcon } from "../components/NavIcons";
import { AppVersionRow } from "./AppVersionRow";

type Props = { indexes: Indexes };
type IconComponent = ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;

const TABS: { to: string; labelKey: string; Icon: IconComponent }[] = [
  { to: "/today",    labelKey: "nav.today",    Icon: TodayIcon },
  { to: "/inbox",    labelKey: "nav.inbox",    Icon: InboxIcon },
  { to: "/calendar", labelKey: "nav.calendar", Icon: CalendarIcon },
];

// Secondary destinations behind the More tab. Text-only — glyph icons competed
// with labels on a dense phone menu.
const MORE_ITEMS = [
  { to: "/templates",  labelKey: "nav.templates" },
  { to: "/dashboard",  labelKey: "nav.dashboard" },
  { to: "/history",    labelKey: "nav.history" },
  { to: "/tags",       labelKey: "nav.tags" },
  { to: "/archived",   labelKey: "nav.archived" },
  { to: "/settings",   labelKey: "nav.settings" },
] as const;

export function BottomTabs({ indexes }: Props) {
  const { t: tr } = useTranslation();
  const todayCount = openCount(indexes.today(indexes.todayIso));
  // Inbox badge is a presence indicator only: open uncategorized tasks exist, not a tally.
  const inboxHasOpen = openCount(indexes.inbox) > 0;
  const loc = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const onMorePage = MORE_ITEMS.some(i => loc.pathname === i.to);

  // Navigating (via a menu item or anything else) always dismisses the menu.
  useEffect(() => { setMoreOpen(false); }, [loc.pathname]);

  return (
    <div className="bottom-tabs-wrap">
      {moreOpen && (
        <>
          <div className="mobile-menu-backdrop" onClick={() => setMoreOpen(false)} />
          <nav className="mobile-menu" role="menu" aria-label={tr("nav.more")}>
            {MORE_ITEMS.map(item => (
              <Link key={item.to} to={item.to} role="menuitem" className="mobile-menu-item"
                    onClick={() => setMoreOpen(false)}>
                {tr(item.labelKey)}
              </Link>
            ))}
            {/* Same version/update footer as the desktop sidebar; Android has
                no sidebar, so this is the only place the running build shows. */}
            <AppVersionRow className="mobile-menu-version" />
          </nav>
        </>
      )}
      <nav className="bottom-tabs" role="navigation" aria-label="Primary">
        {TABS.map(({ to, labelKey, Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) => isActive ? "bottom-tab active" : "bottom-tab"}
          >
            <span className="bottom-tab-icon" aria-hidden>
              <Icon size={20} />
            </span>
            <span className="bottom-tab-label">{tr(labelKey)}</span>
            {to === "/today" && todayCount > 0 && (
              <span className="bottom-tab-badge" data-testid="today-badge">{todayCount}</span>
            )}
            {to === "/inbox" && inboxHasOpen && (
              <span className="bottom-tab-badge bottom-tab-badge-dot" data-testid="inbox-badge" aria-hidden="true" />
            )}
          </NavLink>
        ))}
        <button
          type="button"
          className={`bottom-tab${moreOpen || onMorePage ? " active" : ""}`}
          aria-haspopup="menu"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen(open => !open)}
        >
          <span className="bottom-tab-icon" aria-hidden>
            <MoreIcon size={20} />
          </span>
          <span className="bottom-tab-label">{tr("nav.more")}</span>
        </button>
      </nav>
    </div>
  );
}
