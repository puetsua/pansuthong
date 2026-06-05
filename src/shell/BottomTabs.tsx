import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Indexes, openCount } from "../state/indexes";

type Props = { indexes: Indexes };

const TABS = [
  { to: "/today",    labelKey: "nav.today",    icon: "●" },
  { to: "/inbox",    labelKey: "nav.inbox",    icon: "▣" },
  { to: "/upcoming", labelKey: "nav.upcoming", icon: "◔" },
] as const;

export function BottomTabs({ indexes }: Props) {
  const { t: tr } = useTranslation();
  const todayCount = openCount(indexes.today(indexes.todayIso));
  const inboxCount = openCount(indexes.inbox);

  return (
    <nav className="bottom-tabs" role="navigation" aria-label="Primary">
      {TABS.map(t => (
        <NavLink
          key={t.to}
          to={t.to}
          className={({ isActive }) => isActive ? "bottom-tab active" : "bottom-tab"}
        >
          <span className="bottom-tab-icon" aria-hidden>{t.icon}</span>
          <span className="bottom-tab-label">{tr(t.labelKey)}</span>
          {t.to === "/today" && todayCount > 0 && <span className="bottom-tab-badge">{todayCount}</span>}
          {t.to === "/inbox" && inboxCount > 0 && <span className="bottom-tab-badge">{inboxCount}</span>}
        </NavLink>
      ))}
    </nav>
  );
}
