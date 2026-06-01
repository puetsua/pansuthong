import { Document } from "../lib/tauri";
import { TaskList } from "../components/TaskList";
import { Indexes } from "../state/indexes";
import { todayIso } from "../lib/dates";

type Props = { doc: Document; indexes: Indexes };

export function ArchivedView({ indexes }: Props) {
  const archived = indexes.archived;

  return (
    <section>
      <header className="view-header">
        <div className="view-title-row">
          <h1>Archived</h1>
        </div>
        <p className="view-sub">{archived.length} archived · Restore brings a task back to the active lists</p>
      </header>
      <TaskList tasks={archived} tags={indexes.tagsById} todayIso={todayIso()}
                emptyText="No archived tasks yet." archived />
    </section>
  );
}
