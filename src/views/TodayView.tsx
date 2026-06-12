import { useTranslation } from "react-i18next";
import { Composer } from "../components/Composer";
import { GhostRow } from "../components/GhostRow";
import { TaskList } from "../components/TaskList";
import { Document, Task, isDone } from "../lib/tauri";
import { isoLt } from "../lib/dates";
import { Indexes, openCount } from "../state/indexes";

type Props = { doc: Document; indexes: Indexes };

/** Still-open and due before today; these get their own section below Today's list. */
function isOverdue(task: Task, todayIso: string): boolean {
  return !isDone(task) && task.due_date != null && isoLt(task.due_date, todayIso);
}

export function TodayView({ indexes }: Props) {
  const { t } = useTranslation();
  const today = indexes.todayIso;
  // `indexes.today` already sorts the combined list; partitioning preserves that order
  // within each group. Overdue tasks render in their own section below today's tasks.
  const all = indexes.today(today);
  const overdue = all.filter(task => isOverdue(task, today));
  const todays = all.filter(task => !isOverdue(task, today));
  const ghosts = indexes.ghostsForDate(today);
  const remaining = openCount(all);
  return (
    <section>
      <header className="view-header">
        <h1>{t("nav.today")}</h1>
        <p className="view-sub">{today} · {t("common.taskCount", { count: remaining })}</p>
      </header>
      <Composer startDate={today} todayIso={today} tagsByName={indexes.tagsByName} allTags={indexes.tagsById} />
      {ghosts.map(g => <GhostRow key={g.id} ghost={g} tags={indexes.tagsById} />)}
      <TaskList tasks={todays} tags={indexes.tagsById} todayIso={today}
                emptyText={t("today.empty")} />
      {overdue.length > 0 && (
        <div className="overdue-group">
          <h3 className="overdue-heading">{t("today.overdue")} · {t("common.taskCount", { count: overdue.length })}</h3>
          <TaskList tasks={overdue} tags={indexes.tagsById} todayIso={today} />
        </div>
      )}
    </section>
  );
}
