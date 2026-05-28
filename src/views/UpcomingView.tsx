import dayjs from "dayjs";
import { TaskList } from "../components/TaskList";
import { Indexes } from "../state/indexes";
import { Task } from "../lib/tauri";
import { todayIso } from "../lib/dates";

type Props = { indexes: Indexes };

const HORIZON_DAYS = 14;

export function UpcomingView({ indexes }: Props) {
  const today = todayIso();
  const groups = buildGroups(indexes, today);
  const totalCount = groups.reduce((n, g) => n + g.tasks.length, 0);

  return (
    <section>
      <header className="view-header">
        <h1>Upcoming</h1>
        <p className="view-sub">Next {HORIZON_DAYS} days · {totalCount} task{totalCount === 1 ? "" : "s"}</p>
      </header>
      {groups.map(g => (
        <div key={g.date} className="upcoming-group">
          <h3 className="upcoming-day">{g.label}</h3>
          <TaskList tasks={g.tasks} tags={indexes.tagsById} todayIso={today} />
        </div>
      ))}
      {totalCount === 0 && <p className="view-empty">Nothing in the next two weeks.</p>}
    </section>
  );
}

type Group = { date: string; label: string; tasks: Task[] };

function buildGroups(indexes: Indexes, todayStr: string): Group[] {
  const today = dayjs(todayStr);
  const result: Group[] = [];
  for (let i = 1; i <= HORIZON_DAYS; i++) {
    const day = today.add(i, "day");
    const iso = day.format("YYYY-MM-DD");
    const tasks = indexes.tasks.filter(t => t.scheduled_date === iso || t.due_date === iso);
    if (tasks.length > 0) result.push({ date: iso, label: labelFor(day, today), tasks });
  }
  return result;
}

function labelFor(day: dayjs.Dayjs, today: dayjs.Dayjs): string {
  const diff = day.diff(today, "day");
  if (diff === 1) return `Tomorrow · ${day.format("ddd MMM D")}`;
  if (diff < 7)   return day.format("dddd · MMM D");
  return day.format("ddd, MMM D");
}
