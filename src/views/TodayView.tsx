import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AssignIdle } from "../components/AssignIdle";
import { Composer } from "../components/Composer";
import { IdleStatus } from "../components/IdleStatus";
import { RowList } from "../components/RowList";
import { TaskList } from "../components/TaskList";
import { Document, isDone } from "../lib/tauri";
import { formatIsoDate, isOverdue } from "../lib/dates";
import { currentLocale } from "../i18n";
import { dateFormat } from "../lib/settings";
import { useIdleAnchor } from "../lib/useIdleAnchor";
import { Indexes, openCount } from "../state/indexes";

type Props = { doc: Document; indexes: Indexes };

export function TodayView({ doc, indexes }: Props) {
  const { t } = useTranslation();
  const [assigning, setAssigning] = useState(false);
  const { idleAnchorMs, resetIdleAnchor } = useIdleAnchor();
  const today = indexes.todayIso;
  const todayLabel = formatIsoDate(today, dateFormat(doc.settings), currentLocale());
  // `indexes.today` already sorts the combined list; partitioning preserves that order
  // within each group. Overdue tasks render in their own section below today's tasks.
  const all = indexes.today(today);
  const overdue = all.filter(task => isOverdue(task.due_date, today, isDone(task)));
  const todays = all.filter(task => !isOverdue(task.due_date, today, isDone(task)));
  // Recurring ghosts for today are merged into the same sorted sequence as today's
  // tasks, so a ghost sits where its promoted task would (#9) — promoting it no
  // longer jumps it out of a separate block at the top.
  const todayRows = indexes.mergeRows(todays, indexes.ghostsForDate(today));
  const remaining = openCount(all);
  const candidates = all.filter(task => !isDone(task));
  return (
    <section>
      <header className="view-header">
        <h1>{t("nav.today")}</h1>
        <p className="view-sub">
          {todayLabel} · {t("common.taskCount", { count: remaining })}
          <IdleStatus tasks={doc.tasks} active={assigning} idleAnchorMs={idleAnchorMs}
                      onResetIdle={resetIdleAnchor}
                      onAssign={candidates.length > 0 ? () => setAssigning(a => !a) : undefined} />
        </p>
      </header>
      {assigning ? (
        <AssignIdle tasks={doc.tasks} candidates={candidates} idleAnchorMs={idleAnchorMs}
                    onClose={() => setAssigning(false)} />
      ) : (
        <Composer startDate={today} todayIso={today} tagsByName={indexes.tagsByName} allTags={indexes.tagsById} />
      )}
      <RowList rows={todayRows} tags={indexes.tagsById} todayIso={today}
               emptyText={t("today.empty")} onTimerStarted={() => setAssigning(false)} />
      {overdue.length > 0 && (
        <div className="overdue-group">
          <h3 className="overdue-heading">{t("today.overdue")} · {t("common.taskCount", { count: overdue.length })}</h3>
          <TaskList tasks={overdue} tags={indexes.tagsById} todayIso={today}
                    onTimerStarted={() => setAssigning(false)} />
        </div>
      )}
    </section>
  );
}
