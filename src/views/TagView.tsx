import { useState } from "react";
import { useParams, Navigate, useNavigate } from "react-router-dom";
import { Composer } from "../components/Composer";
import { TaskList } from "../components/TaskList";
import { TagEditor } from "../components/TagEditor";
import { Indexes } from "../state/indexes";
import { useHeldCompletions, withHeld } from "../state/heldCompletions";
import { Document, isDone } from "../lib/tauri";
import { todayIso } from "../lib/dates";

type Props = { doc: Document; indexes: Indexes };

export function TagView({ doc, indexes }: Props) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  // Hold just-completed tasks visible until this view is left/refreshed (#recover).
  const { held, onCompleted, onReopened } = useHeldCompletions(doc.tasks);

  if (!id) return <Navigate to="/today" replace />;

  const tag = indexes.tagsById.get(id);
  if (!tag) return <p className="view-empty">Tag not found.</p>;

  const active = indexes.byTag.get(id) ?? [];
  const tasks = withHeld(active, held);
  const open  = active.filter(t => !isDone(t)).length;

  return (
    <section>
      <header className="view-header">
        <div className="view-title-row">
          <h1><span style={{ color: tag.color }}>#</span>{tag.name}</h1>
          <button type="button" className="link-button tag-edit-link"
                  onClick={() => setEditing(true)}>Edit tag</button>
        </div>
        <p className="view-sub">{open} open / {tasks.length} total</p>
      </header>
      <Composer tagsByName={indexes.tagsByName} />
      <TaskList tasks={tasks} tags={indexes.tagsById} todayIso={todayIso()}
                emptyText="No tasks with this tag yet."
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
