import { useState } from "react";
import { api, Document, Tag } from "../lib/tauri";
import { errorMessage } from "../lib/errors";
import { Indexes } from "../state/indexes";
import { TagEditor } from "../components/TagEditor";

type Props = { doc: Document; indexes: Indexes };

// `null` = closed; `{ tag: null }` = add a new tag; `{ tag }` = edit that tag.
type EditorState = { tag: Tag | null } | null;

export function TagsView({ doc, indexes }: Props) {
  const [editor, setEditor] = useState<EditorState>(null);
  const [error, setError] = useState<string | null>(null);

  const tags = [...doc.tags].sort(
    (a, b) => b.priority - a.priority || a.name.localeCompare(b.name),
  );

  const remove = async (t: Tag) => {
    if (!window.confirm(`Delete tag #${t.name}? It will be removed from all tasks.`)) return;
    try { await api.deleteTag(t.id); setError(null); }
    catch (err) { setError(errorMessage(err)); }
  };

  return (
    <section>
      <header className="view-header">
        <div className="view-title-row">
          <h1>Tags</h1>
          <button type="button" className="link-button tag-edit-link"
                  onClick={() => { setError(null); setEditor({ tag: null }); }}>Add tag</button>
        </div>
        <p className="view-sub">
          A task's priority is the highest weight among its tags.
        </p>
      </header>

      {error && <p className="composer-error">{error}</p>}

      <ul className="settings-list">
        {tags.length === 0 && (
          <li className="settings-empty">No tags yet. Use “Add tag” to create one.</li>
        )}
        {tags.map(t => {
          const count = indexes.byTag.get(t.id)?.length ?? 0;
          return (
            <li key={t.id}>
              <span className="color-dot" style={{ background: t.color }} />
              <span className="settings-name">#{t.name}</span>
              <span className="tag-count">{count} {count === 1 ? "task" : "tasks"}</span>
              <span className="tag-weight" title="priority weight">{t.priority}</span>
              <button className="link-button" onClick={() => { setError(null); setEditor({ tag: t }); }}>edit</button>
              <button className="link-button danger" onClick={() => remove(t)}>delete</button>
            </li>
          );
        })}
      </ul>

      {editor && <TagEditor tag={editor.tag} onClose={() => setEditor(null)} />}
    </section>
  );
}
