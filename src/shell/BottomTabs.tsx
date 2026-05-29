import { NavLink } from "react-router-dom";
import { Indexes } from "../state/indexes";
import { todayIso } from "../lib/dates";

type Props = { indexes: Indexes };

const TABS = [
  { to: "/today",    label: "Today",    icon: "●" },
  { to: "/inbox",    label: "Inbox",    icon: "▣" },
  { to: "/upcoming", label: "Upcoming", icon: "◔" },
  { to: "/search",   label: "Search",   icon: "⌕" },
] as const;

export function BottomTabs({ indexes }: Props) {
  const todayCount = indexes.today(todayIso()).length;
  const inboxCount = indexes.inbox.length;

  return (
    <nav className="bottom-tabs" role="navigation" aria-label="Primary">
      {TABS.map(t => (
        <NavLink
          key={t.to}
          to={t.to}
          className={({ isActive }) => isActive ? "bottom-tab active" : "bottom-tab"}
        >
          <span className="bottom-tab-icon" aria-hidden>{t.icon}</span>
          <span className="bottom-tab-label">{t.label}</span>
          {t.to === "/today" && todayCount > 0 && <span className="bottom-tab-badge">{todayCount}</span>}
          {t.to === "/inbox" && inboxCount > 0 && <span className="bottom-tab-badge">{inboxCount}</span>}
        </NavLink>
      ))}
    </nav>
  );
}
