import { useParams, Navigate } from "react-router-dom";
import { Composer } from "../components/Composer";
import { TaskList } from "../components/TaskList";
import { Indexes } from "../state/indexes";
import { todayIso } from "../lib/dates";

type Props = { indexes: Indexes };

export function ProjectView({ indexes }: Props) {
  const { id } = useParams<{ id: string }>();
  if (!id) return <Navigate to="/today" replace />;

  const project = indexes.projectsById.get(id);
  if (!project) return <p className="view-empty">Project not found.</p>;

  const tasks = indexes.byProject.get(id) ?? [];
  const open  = tasks.filter(t => !t.done).length;

  return (
    <section>
      <header className="view-header">
        <h1>
          <span className="project-dot" style={{ background: project.color }} />
          {project.name}
        </h1>
        <p className="view-sub">{open} open / {tasks.length} total</p>
      </header>
      <Composer tagsByName={indexes.tagsByName} />
      <TaskList tasks={tasks} tags={indexes.tagsById} todayIso={todayIso()}
                emptyText="No tasks in this project yet." />
    </section>
  );
}
