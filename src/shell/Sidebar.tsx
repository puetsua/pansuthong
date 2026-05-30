import { useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { Document, Tag } from "../lib/tauri";
import { Indexes, openCount } from "../state/indexes";
import { todayIso } from "../lib/dates";
import { SyncStatus } from "../components/SyncStatus";
import { TagEditor } from "../components/TagEditor";

type Props = { doc: Document; indexes: Indexes };

// `null` = closed; `{ tag: null }` = add a new tag; `{ tag }` = edit that tag.
type EditorState = { tag: Tag | null } | null;

export function Sidebar({ doc, indexes }: Props) {
  const today = todayIso();
  const todayCount = openCount(indexes.today(today));
  const inboxCount = openCount(indexes.inbox);

  const navigate = useNavigate();
  const location = useLocation();
  const [editor, setEditor] = useState<EditorState>(null);

  const tags = [...doc.tags].sort(
    (a, b) => b.priority - a.priority || a.name.localeCompare(b.name),
  );

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

      <div className="sidebar-section">
        <NavLink to="/tags" className={({ isActive }) => isActive ? "sidebar-section-link active" : "sidebar-section-link"}>Tags</NavLink>
        <button type="button" className="sidebar-icon-btn" aria-label="Add tag"
                onClick={() => setEditor({ tag: null })}>+</button>
      </div>
      <ul className="sidebar-list">
        {tags.map(t => (
          <li className="sidebar-tag-row" key={t.id}>
            <NavLink to={`/tag/${t.id}`} className={({ isActive }) => isActive ? "sidebar-link active" : "sidebar-link"}>
              <span className="sidebar-dot" style={{ background: t.color }} />
              #{t.name}
              <span className="sidebar-count">{indexes.byTag.get(t.id)?.length ?? 0}</span>
            </NavLink>
            <button type="button" className="sidebar-icon-btn tag-edit-btn" aria-label={`Edit #${t.name}`}
                    onClick={() => setEditor({ tag: t })}>✎</button>
          </li>
        ))}
      </ul>

      <div style={{ marginTop: "auto" }}>
        <ul className="sidebar-list">
          <li>
            <NavLink to="/settings" className={({ isActive }) => isActive ? "sidebar-link active" : "sidebar-link"}>
              Settings
            </NavLink>
          </li>
        </ul>
        <SyncStatus lastModified={doc.last_modified} />
      </div>

      {editor && (
        <TagEditor
          tag={editor.tag}
          onClose={() => setEditor(null)}
          onDeleted={() => {
            const deletedId = editor.tag?.id;
            setEditor(null);
            if (deletedId && location.pathname === `/tag/${deletedId}`) navigate("/today");
          }}
        />
      )}
    </nav>
  );
}
