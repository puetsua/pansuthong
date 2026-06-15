import { useTranslation } from "react-i18next";
import { Composer } from "../components/Composer";
import { RowList } from "../components/RowList";
import { TaskList } from "../components/TaskList";
import { Document, Task, isDone } from "../lib/tauri";
import { formatIsoDate, isoLt } from "../lib/dates";
import { currentLocale } from "../i18n";
import { dateFormat } from "../lib/settings";
import { Indexes, openCount } from "../state/indexes";

type Props = { doc: Document; indexes: Indexes };

/** Still-open and due before today; these get their own section below Today's list. */
function isOverdue(task: Task, todayIso: string): boolean {
  return !isDone(task) && task.due_date != null && isoLt(task.due_date, todayIso);
}

export function TodayView({ doc, indexes }: Props) {
  const { t } = useTranslation();
  const today = indexes.todayIso;
  const todayLabel = formatIsoDate(today, dateFormat(doc.settings), currentLocale());
  // `indexes.today` already sorts the combined list; partitioning preserves that order
  // within each group. Overdue tasks render in their own section below today's tasks.
  const all = indexes.today(today);
  const overdue = all.filter(task => isOverdue(task, today));
  const todays = all.filter(task => !isOverdue(task, today));
  // Recurring ghosts for today are merged into the same sorted sequence as today's
  // tasks, so a ghost sits where its promoted task would (#9) — promoting it no
  // longer jumps it out of a separate block at the top.
  const todayRows = indexes.mergeRows(todays, indexes.ghostsForDate(today));
  const remaining = openCount(all);
  return (
    <section>
      <header className="view-header">
        <h1>{t("nav.today")}</h1>
        <p className="view-sub">{todayLabel} · {t("common.taskCount", { count: remaining })}</p>
      </header>
      <Composer startDate={today} todayIso={today} tagsByName={indexes.tagsByName} allTags={indexes.tagsById} />
      <RowList rows={todayRows} tags={indexes.tagsById} todayIso={today}
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
