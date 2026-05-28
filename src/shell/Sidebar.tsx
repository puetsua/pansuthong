import { NavLink } from "react-router-dom";
import { Document } from "../lib/tauri";
import { Indexes } from "../state/indexes";
import { todayIso } from "../lib/dates";

type Props = { doc: Document; indexes: Indexes };

export function Sidebar({ doc, indexes }: Props) {
  const today = todayIso();
  const todayCount = indexes.today(today).length;
  const inboxCount = indexes.inbox.length;

  return (
    <nav className="sidebar">
      <ul className="sidebar-list">
        <li>
          <NavLink to="/today" className={({ isActive }) => isActive ? "sidebar-link active" : "sidebar-link"}>
            Today <span className="sidebar-count">{todayCount}</span>
          </NavLink>
        </li>
        <li>
          <NavLink to="/inbox" className={({ isActive }) => isActive ? "sidebar-link active" : "sidebar-link"}>
            Inbox <span className="sidebar-count">{inboxCount}</span>
          </NavLink>
        </li>
        <li>
          <NavLink to="/upcoming" className={({ isActive }) => isActive ? "sidebar-link active" : "sidebar-link"}>
            Upcoming
          </NavLink>
        </li>
        <li>
          <NavLink to="/search" className={({ isActive }) => isActive ? "sidebar-link active" : "sidebar-link"}>
            Search
          </NavLink>
        </li>
      </ul>

      {doc.projects.length > 0 && (
        <>
          <div className="sidebar-section">Projects</div>
          <ul className="sidebar-list">
            {doc.projects.map(p => (
              <li key={p.id}>
                <NavLink to={`/project/${p.id}`} className={({ isActive }) => isActive ? "sidebar-link active" : "sidebar-link"}>
                  <span className="sidebar-dot" style={{ background: p.color }} />
                  {p.name}
                  <span className="sidebar-count">{indexes.byProject.get(p.id)?.length ?? 0}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </>
      )}

      {doc.tags.length > 0 && (
        <>
          <div className="sidebar-section">Tags</div>
          <ul className="sidebar-list">
            {doc.tags.filter(t => !t.project_id).map(t => (
              <li key={t.id}>
                <NavLink to={`/tag/${t.id}`} className={({ isActive }) => isActive ? "sidebar-link active" : "sidebar-link"}>
                  #{t.name}
                </NavLink>
              </li>
            ))}
          </ul>
        </>
      )}

      <div style={{ marginTop: "auto" }}>
        <ul className="sidebar-list">
          <li>
            <NavLink to="/settings" className={({ isActive }) => isActive ? "sidebar-link active" : "sidebar-link"}>
              Settings
            </NavLink>
          </li>
        </ul>
      </div>
    </nav>
  );
}
