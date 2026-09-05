import { useEffect, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Document, Tag } from "../lib/tauri";
import { Indexes, openCount } from "../state/indexes";
import { normalizeTagHashColor } from "../lib/tagColorDisplay";
import { useThemeVariant } from "../lib/useThemeVariant";
import { TagEditor } from "../components/TagEditor";
import { AppVersionRow } from "./AppVersionRow";
import { pinTagToDashboard } from "../lib/dashboard-tags";

type Props = { doc: Document; indexes: Indexes };

// `null` = closed; `{ tag: null }` = add a new tag; `{ tag }` = edit that tag.
type EditorState = { tag: Tag | null } | null;
type ContextMenuState = { tag: Tag; x: number; y: number };

export function Sidebar({ doc, indexes }: Props) {
  const { t } = useTranslation();
  const theme = useThemeVariant(doc.settings);
  const today = indexes.todayIso;
  const todayCount = openCount(indexes.today(today));
  // Inbox is a catch-all view, not a tally — no sidebar count (matches Upcoming).

  const navigate = useNavigate();
  const location = useLocation();
  const [editor, setEditor] = useState<EditorState>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [contextMenu]);

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
            {t("nav.inbox")}
          </NavLink>
        </li>
        <li>
          <NavLink to="/upcoming" className={({ isActive }) => isActive ? "sidebar-link active" : "sidebar-link"}>
            {t("nav.upcoming")}
          </NavLink>
        </li>
        <li>
          <NavLink to="/search" className={({ isActive }) => isActive ? "sidebar-link active" : "sidebar-link"}>
            {t("nav.search")}
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
          <li
            className="sidebar-tag-row"
            key={t2.id}
            onContextMenu={e => {
              if (t2.dashboard_view) return;
              e.preventDefault();
              setContextMenu({ tag: t2, x: e.clientX, y: e.clientY });
            }}
          >
            <NavLink to={`/tag/${t2.id}`} className={({ isActive }) => isActive ? "sidebar-link active" : "sidebar-link"}>
              <span className="sidebar-hash" aria-hidden="true" style={{ color: normalizeTagHashColor(t2.color, theme) }}>#</span>
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
            <NavLink to="/dashboard" className={({ isActive }) => isActive ? "sidebar-link active" : "sidebar-link"}>
              {t("nav.dashboard")}
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
        {/* Either half can be missing: `appVersion()` returns null on any
            failure, and that must not take the update entry point down with it. */}
        <AppVersionRow />
      </div>

      {contextMenu && (
        <>
          <div
            className="sidebar-ctx-backdrop"
            onClick={() => setContextMenu(null)}
            onContextMenu={e => { e.preventDefault(); setContextMenu(null); }}
          />
          <div
            className="sidebar-ctx-menu"
            role="menu"
            style={{ top: contextMenu.y, left: contextMenu.x }}
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                void pinTagToDashboard(contextMenu.tag);
                setContextMenu(null);
              }}
            >
              {t("sidebar.addToDashboard")}
            </button>
          </div>
        </>
      )}

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
