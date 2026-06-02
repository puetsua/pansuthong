import dayjs from "dayjs";
import { TaskList } from "../components/TaskList";
import { effectivePriority, Indexes } from "../state/indexes";
import { Document, Task } from "../lib/tauri";
import { todayIso } from "../lib/dates";
import { upcomingDays } from "../lib/settings";

type Props = { doc: Document; indexes: Indexes };

export function UpcomingView({ doc, indexes }: Props) {
  const today = todayIso();
  const horizon = upcomingDays(doc.settings);
  const groups = buildGroups(indexes, today, horizon);
  const totalCount = new Set(groups.flatMap(g => g.tasks.map(t => t.id))).size;

  return (
    <section>
      <header className="view-header">
        <h1>Upcoming</h1>
        <p className="view-sub">Next {horizon} day{horizon === 1 ? "" : "s"} · {totalCount} task{totalCount === 1 ? "" : "s"}</p>
      </header>
      {groups.map(g => (
        <div key={g.date} className="upcoming-group">
          <h3 className="upcoming-day">{g.label}</h3>
          <TaskList tasks={g.tasks} tags={indexes.tagsById} todayIso={today} />
        </div>
      ))}
      {totalCount === 0 && (
        <p className="view-empty">Nothing in the next {horizon} day{horizon === 1 ? "" : "s"}.</p>
      )}
    </section>
  );
}

type Group = { date: string; label: string; tasks: Task[] };

function buildGroups(indexes: Indexes, todayStr: string, horizon: number): Group[] {
  const today = dayjs(todayStr);
  const result: Group[] = [];
  for (let i = 1; i <= horizon; i++) {
    const day = today.add(i, "day");
    const iso = day.format("YYYY-MM-DD");
    // All tasks in a group share this date, so order them by priority (weight desc).
    const tasks = indexes.tasks
      .filter(t => t.start_date === iso || t.due_date === iso)
      .sort((a, b) => effectivePriority(b, indexes.tagsById) - effectivePriority(a, indexes.tagsById));
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
