import { Composer } from "../components/Composer";
import { TaskList } from "../components/TaskList";
import { Document, Tag } from "../lib/tauri";
import { Indexes } from "../state/indexes";
import { todayIso } from "../lib/dates";

type Props = { doc: Document; indexes: Indexes };

function tagsByNameLower(tagsById: Map<string, Tag>): Map<string, Tag> {
  const out = new Map<string, Tag>();
  for (const t of tagsById.values()) out.set(t.name.toLowerCase(), t);
  return out;
}

export function InboxView({ indexes }: Props) {
  const tasks = indexes.inbox;
  return (
    <section>
      <header className="view-header">
        <h1>Inbox</h1>
        <p className="view-sub">Tasks without a project</p>
      </header>
      <Composer tagsByName={tagsByNameLower(indexes.tagsById)} />
      <TaskList tasks={tasks} tags={indexes.tagsById} todayIso={todayIso()}
                emptyText="Inbox is empty." />
    </section>
  );
}
