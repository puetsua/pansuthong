import { Composer } from "../components/Composer";
import { TaskList } from "../components/TaskList";
import { Document } from "../lib/tauri";
import { Indexes } from "../state/indexes";
import { todayIso } from "../lib/dates";

type Props = { doc: Document; indexes: Indexes };

export function InboxView({ indexes }: Props) {
  const tasks = indexes.inbox;
  return (
    <section>
      <header className="view-header">
        <h1>Inbox</h1>
        <p className="view-sub">Tasks without a project</p>
      </header>
      <Composer />
      <TaskList tasks={tasks} tags={indexes.tagsById} todayIso={todayIso()}
                emptyText="Inbox is empty." />
    </section>
  );
}
