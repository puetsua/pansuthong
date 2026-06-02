import { Composer } from "../components/Composer";
import { TaskList } from "../components/TaskList";
import { Document } from "../lib/tauri";
import { Indexes, openCount } from "../state/indexes";

type Props = { doc: Document; indexes: Indexes };

export function TodayView({ indexes }: Props) {
  const today = indexes.todayIso;
  const tasks = indexes.today(today);
  const remaining = openCount(tasks);
  return (
    <section>
      <header className="view-header">
        <h1>Today</h1>
        <p className="view-sub">{today} · {remaining} task{remaining === 1 ? "" : "s"}</p>
      </header>
      <Composer startDate={today} todayIso={today} tagsByName={indexes.tagsByName} />
      <TaskList tasks={tasks} tags={indexes.tagsById} todayIso={today}
                emptyText="No tasks starting or due today." />
    </section>
  );
}
