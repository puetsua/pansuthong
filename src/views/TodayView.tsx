import { Composer } from "../components/Composer";
import { TaskList } from "../components/TaskList";
import { Document } from "../lib/tauri";
import { Indexes } from "../state/indexes";
import { todayIso } from "../lib/dates";

type Props = { doc: Document; indexes: Indexes };

export function TodayView({ indexes }: Props) {
  const today = todayIso();
  const tasks = indexes.today(today);
  return (
    <section>
      <header className="view-header">
        <h1>Today</h1>
        <p className="view-sub">{today} · {tasks.length} task{tasks.length === 1 ? "" : "s"}</p>
      </header>
      <Composer scheduledDate={today} tagsByName={indexes.tagsByName} />
      <TaskList tasks={tasks} tags={indexes.tagsById} todayIso={today}
                emptyText="No tasks scheduled or due today." />
    </section>
  );
}
