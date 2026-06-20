import { useEffect, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Document, Tag } from "../lib/tauri";
import { appVersion } from "../lib/platform";
import { Indexes, openCount } from "../state/indexes";
import { SyncStatus } from "../components/SyncStatus";
import { TagEditor } from "../components/TagEditor";

const RELEASES_BASE = "https://github.com/puetsua/pansutong/releases/tag/";

type Props = { doc: Document; indexes: Indexes };

// `null` = closed; `{ tag: null }` = add a new tag; `{ tag }` = edit that tag.
type EditorState = { tag: Tag | null } | null;

export function Sidebar({ doc, indexes }: Props) {
  const { t } = useTranslation();
  const today = indexes.todayIso;
  const todayCount = openCount(indexes.today(today));
  const inboxCount = openCount(indexes.inbox);

  const navigate = useNavigate();
  const location = useLocation();
  const [editor, setEditor] = useState<EditorState>(null);

  // Show the running version in the footer; null (e.g. in tests) hides the label.
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void appVersion().then(v => { if (active) setVersion(v); });
    return () => { active = false; };
  }, []);

  // Only pinned tags appear in the sidebar; the full set lives on the Tags
  // screen, where tags are pinned/unpinned (#78).
  const tags = doc.tags
    .filter(t => t.pinned)
    .sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name));

  return (
    <nav className="sidebar">
      <ul className="sidebar-list">
        <li>
          <NavLink to="/today" className={({ isActive }) => isActive ? "sidebar-link active" : "sidebar-link"}>
            {t("nav.today")} <span className="sidebar-count">{todayCount}</span>
          </NavLink>
        </li>
        <li>
          <NavLink to="/inbox" className={({ isActive }) => isActive ? "sidebar-link active" : "sidebar-link"}>
            {t("nav.inbox")} <span className="sidebar-count">{inboxCount}</span>
          </NavLink>
        </li>
        <li>
          <NavLink to="/upcoming" className={({ isActive }) => isActive ? "sidebar-link active" : "sidebar-link"}>
            {t("nav.upcoming")}
          </NavLink>
        </li>
      </ul>

      <div className="sidebar-section">
        <NavLink to="/tags" className={({ isActive }) => isActive ? "sidebar-section-link active" : "sidebar-section-link"}>{t("nav.tags")}</NavLink>
        <button type="button" className="sidebar-icon-btn" aria-label={t("sidebar.addTag")}
                onClick={() => setEditor({ tag: null })}>+</button>
      </div>
      <ul className="sidebar-list">
        {tags.length === 0 ? (
          <li className="sidebar-empty">
            {t("sidebar.noPinnedTags")} <NavLink to="/tags" className="sidebar-empty-link">{t("sidebar.manageTags")}</NavLink>
          </li>
        ) : tags.map(t2 => (
          <li className="sidebar-tag-row" key={t2.id}>
            <NavLink to={`/tag/${t2.id}`} className={({ isActive }) => isActive ? "sidebar-link active" : "sidebar-link"}>
              <span className="sidebar-hash" aria-hidden="true" style={{ color: t2.color }}>#</span>
              {t2.name}
              <span className="sidebar-count">{indexes.byTag.get(t2.id)?.length ?? 0}</span>
            </NavLink>
            <button type="button" className="sidebar-icon-btn tag-edit-btn" aria-label={t("sidebar.editTag", { name: t2.name })}
                    onClick={() => setEditor({ tag: t2 })}>✎</button>
          </li>
        ))}
      </ul>

      <div style={{ marginTop: "auto" }}>
        <ul className="sidebar-list">
          <li>
            <NavLink to="/archived" className={({ isActive }) => isActive ? "sidebar-link active" : "sidebar-link"}>
              {t("nav.archived")} <span className="sidebar-count">{indexes.archived.length}</span>
            </NavLink>
          </li>
          <li>
            <NavLink to="/templates" className={({ isActive }) => isActive ? "sidebar-link active" : "sidebar-link"}>
              {t("nav.templates")} <span className="sidebar-count">{indexes.templates.length}</span>
            </NavLink>
          </li>
          <li>
            <NavLink to="/recurrence" className={({ isActive }) => isActive ? "sidebar-link active" : "sidebar-link"}>
              {t("nav.recurrence")}
            </NavLink>
          </li>
          <li>
            <NavLink to="/history" className={({ isActive }) => isActive ? "sidebar-link active" : "sidebar-link"}>
              {t("nav.history")}
            </NavLink>
          </li>
          <li>
            <NavLink to="/settings" className={({ isActive }) => isActive ? "sidebar-link active" : "sidebar-link"}>
              {t("nav.settings")}
            </NavLink>
          </li>
        </ul>
        <SyncStatus lastModified={doc.last_modified} />
        {version && (
          <button type="button" className="sidebar-version"
                  title={t("sidebar.releaseNotes", { version })}
                  onClick={() => void openUrl(RELEASES_BASE + version)}>
            v{version}
          </button>
        )}
      </div>

      {editor && (
        <TagEditor
          tag={editor.tag}
          settings={doc.settings}
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
