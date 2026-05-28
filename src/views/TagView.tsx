import { useParams, Navigate } from "react-router-dom";
import { Composer } from "../components/Composer";
import { TaskList } from "../components/TaskList";
import { Indexes } from "../state/indexes";
import { todayIso } from "../lib/dates";

type Props = { indexes: Indexes };

export function TagView({ indexes }: Props) {
  const { id } = useParams<{ id: string }>();
  if (!id) return <Navigate to="/today" replace />;

  const tag = indexes.tagsById.get(id);
  if (!tag) return <p className="view-empty">Tag not found.</p>;

  const tasks = indexes.byTag.get(id) ?? [];
  const open  = tasks.filter(t => !t.done).length;

  return (
    <section>
      <header className="view-header">
        <h1><span style={{ color: tag.color }}>#</span>{tag.name}</h1>
        <p className="view-sub">{open} open / {tasks.length} total</p>
      </header>
      <Composer tagsByName={indexes.tagsByName} />
      <TaskList tasks={tasks} tags={indexes.tagsById} todayIso={todayIso()}
                emptyText="No tasks with this tag yet." />
    </section>
  );
}
