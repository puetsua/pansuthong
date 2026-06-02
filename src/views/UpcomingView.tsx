import dayjs from "dayjs";
import { TaskList } from "../components/TaskList";
import { effectivePriority, Indexes } from "../state/indexes";
import { useHeldCompletions } from "../state/heldCompletions";
import { Document, Task } from "../lib/tauri";
import { todayIso } from "../lib/dates";
import { upcomingDays } from "../lib/settings";

type Props = { doc: Document; indexes: Indexes };

export function UpcomingView({ doc, indexes }: Props) {
  const today = todayIso();
  const horizon = upcomingDays(doc.settings);
  // Hold just-completed tasks visible (at the bottom of their day) until this view
  // is left or refreshed, so a mis-click can be undone in place (#recover).
  const { held, onCompleted, onReopened } = useHeldCompletions(doc.tasks);
  const groups = buildGroups(indexes, today, horizon, held);
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
          <TaskList tasks={g.tasks} tags={indexes.tagsById} todayIso={today}
                    onCompleted={onCompleted} onReopened={onReopened} />
        </div>
      ))}
      {totalCount === 0 && (
        <p className="view-empty">Nothing in the next {horizon} day{horizon === 1 ? "" : "s"}.</p>
      )}
    </section>
  );
}

type Group = { date: string; label: string; tasks: Task[] };

function buildGroups(indexes: Indexes, todayStr: string, horizon: number, held: Task[]): Group[] {
  const today = dayjs(todayStr);
  const onDay = (t: Task, iso: string) => t.start_date === iso || t.due_date === iso;
  const result: Group[] = [];
  for (let i = 1; i <= horizon; i++) {
    const day = today.add(i, "day");
    const iso = day.format("YYYY-MM-DD");
    // All tasks in a group share this date, so order them by priority (weight desc),
    // then append any held completions for that day (they sort to the bottom).
    const tasks = indexes.tasks
      .filter(t => onDay(t, iso))
      .sort((a, b) => effectivePriority(b, indexes.tagsById) - effectivePriority(a, indexes.tagsById));
    const heldForDay = held.filter(t => onDay(t, iso) && !tasks.some(a => a.id === t.id));
    const all = [...tasks, ...heldForDay];
    if (all.length > 0) result.push({ date: iso, label: labelFor(day, today), tasks: all });
  }
  return result;
}

function labelFor(day: dayjs.Dayjs, today: dayjs.Dayjs): string {
  const diff = day.diff(today, "day");
  if (diff === 1) return `Tomorrow · ${day.format("ddd MMM D")}`;
  if (diff < 7)   return day.format("dddd · MMM D");
  return day.format("ddd, MMM D");
}
