import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { ComponentType, SVGProps } from "react";
import { Indexes, openCount } from "../state/indexes";
import { InboxIcon, TodayIcon, UpcomingIcon } from "../components/NavIcons";

type Props = { indexes: Indexes };
type IconComponent = ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;

const TABS: { to: string; labelKey: string; Icon: IconComponent }[] = [
  { to: "/today",    labelKey: "nav.today",    Icon: TodayIcon },
  { to: "/inbox",    labelKey: "nav.inbox",    Icon: InboxIcon },
  { to: "/upcoming", labelKey: "nav.upcoming", Icon: UpcomingIcon },
];

export function BottomTabs({ indexes }: Props) {
  const { t: tr } = useTranslation();
  const todayCount = openCount(indexes.today(indexes.todayIso));
  // Inbox badge is a presence indicator only: open uncategorized tasks exist, not a tally.
  const inboxHasOpen = openCount(indexes.inbox) > 0;

  return (
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
    </nav>
  );
}
