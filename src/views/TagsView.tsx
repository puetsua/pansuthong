import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { api, Document, Tag } from "../lib/tauri";
import { errorMessage } from "../lib/errors";
import { readableTextColor } from "../lib/tags";
import { Indexes } from "../state/indexes";
import { TagEditor } from "../components/TagEditor";

type Props = { doc: Document; indexes: Indexes };

// `null` = closed; `{ tag: null }` = add a new tag; `{ tag }` = edit that tag.
type EditorState = { tag: Tag | null } | null;

export function TagsView({ doc, indexes }: Props) {
  const { t } = useTranslation();
  const [editor, setEditor] = useState<EditorState>(null);
  const [error, setError] = useState<string | null>(null);

  const tags = [...doc.tags].sort(
    (a, b) => b.priority - a.priority || a.name.localeCompare(b.name),
  );

  const remove = async (tag: Tag) => {
    if (!window.confirm(t("tags.deleteConfirm", { name: tag.name }))) return;
    try { await api.deleteTag(tag.id); setError(null); }
    catch (err) { setError(errorMessage(err)); }
  };

  // Toggle whether the tag appears in the curated sidebar (#78).
  const togglePinned = async (tag: Tag) => {
    try { await api.updateTag({ id: tag.id, pinned: !tag.pinned }); setError(null); }
    catch (err) { setError(errorMessage(err)); }
  };

  return (
    <section>
      <header className="view-header">
        <div className="view-title-row">
          <h1>{t("nav.tags")}</h1>
          <button type="button" className="link-button tag-edit-link"
                  onClick={() => { setError(null); setEditor({ tag: null }); }}>{t("tags.addTag")}</button>
        </div>
        <p className="view-sub">
          {t("tags.subtitle")}
        </p>
      </header>

      {error && <p className="composer-error">{error}</p>}

      <ul className="settings-list">
        {tags.length === 0 && (
          <li className="settings-empty">{t("tags.empty")}</li>
        )}
        {tags.map(tag => {
          const count = indexes.byTag.get(tag.id)?.length ?? 0;
          return (
            <li key={tag.id}>
              <button type="button"
                      className={tag.pinned ? "tag-pin pinned" : "tag-pin"}
                      aria-pressed={tag.pinned ?? false}
                      aria-label={tag.pinned ? t("tags.unpin", { name: tag.name }) : t("tags.pin", { name: tag.name })}
                      title={tag.pinned ? t("tags.pinnedTitle") : t("tags.pinTitle")}
                      onClick={() => togglePinned(tag)}>{tag.pinned ? "★" : "☆"}</button>
              <Link to={`/tag/${tag.id}`} className="settings-name tag-name-link"
                    title={t("tags.viewTagged", { name: tag.name })}>
                <span className="task-tag" style={{ background: tag.color, color: readableTextColor(tag.color) }}>
                  {tag.name}
                </span>
              </Link>
              <span className="tag-count">{t("common.taskCount", { count })}</span>
              <span className="tag-weight" title={t("tags.weightTitle")}>{tag.priority}</span>
              <button className="link-button" onClick={() => { setError(null); setEditor({ tag }); }}>{t("tags.edit")}</button>
              <button className="link-button danger" onClick={() => remove(tag)}>{t("tags.delete")}</button>
            </li>
          );
        })}
      </ul>

      {editor && <TagEditor tag={editor.tag} settings={doc.settings} onClose={() => setEditor(null)} />}
    </section>
  );
}
