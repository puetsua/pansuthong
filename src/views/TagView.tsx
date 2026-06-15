import { useState } from "react";
import { useParams, Navigate, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Composer } from "../components/Composer";
import { RowList } from "../components/RowList";
import { TagEditor } from "../components/TagEditor";
import { Indexes } from "../state/indexes";
import { useHeldCompletions, withHeld } from "../state/heldCompletions";
import { Document, isDone } from "../lib/tauri";

type Props = { doc: Document; indexes: Indexes };

export function TagView({ doc, indexes }: Props) {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  // Hold just-completed tasks visible until this view is left/refreshed (#recover).
  const { held, onCompleted, onReopened } = useHeldCompletions(doc.tasks);

  if (!id) return <Navigate to="/today" replace />;

  const tag = indexes.tagsById.get(id);
  if (!tag) return <p className="view-empty">{t("tagView.notFound")}</p>;

  const active = indexes.byTag.get(id) ?? [];
  const tasks = withHeld(active, held);
  const ghosts = indexes.ghostsForDate(indexes.todayIso).filter(g => g.tag_ids.includes(id));
  const rows = indexes.mergeRows(tasks, ghosts);
  const open  = active.filter(t => !isDone(t)).length;

  return (
    <section>
      <header className="view-header">
        <div className="view-title-row">
          <h1><span style={{ color: tag.color }}>#</span>{tag.name}</h1>
          <button type="button" className="link-button tag-edit-link"
                  onClick={() => setEditing(true)}>{t("tagView.editTag")}</button>
        </div>
        <p className="view-sub">{t("tagView.subtitle", { open, total: tasks.length })}</p>
      </header>
      <Composer todayIso={indexes.todayIso} tagsByName={indexes.tagsByName} allTags={indexes.tagsById} contextTagId={id} />
      <RowList rows={rows} tags={indexes.tagsById} todayIso={indexes.todayIso}
               emptyText={t("tagView.empty")}
               onCompleted={onCompleted} onReopened={onReopened} />
      {editing && (
        <TagEditor
          tag={tag}
          onClose={() => setEditing(false)}
          onDeleted={() => navigate("/today")}
        />
      )}
    </section>
  );
}
