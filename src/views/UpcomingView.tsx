import dayjs from "dayjs";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { AssignIdle } from "../components/AssignIdle";
import { IdleStatus } from "../components/IdleStatus";
import { RowList } from "../components/RowList";
import { Indexes, Row } from "../state/indexes";
import { useHeldCompletions } from "../state/heldCompletions";
import { Document, Task, isDone } from "../lib/tauri";
import { dateFormat, upcomingDays } from "../lib/settings";
import { currentLocale } from "../i18n";
import { formatIsoDate } from "../lib/dates";
import type { DateFormat } from "../lib/dates";

type Props = { doc: Document; indexes: Indexes };

export function UpcomingView({ doc, indexes }: Props) {
  const { t } = useTranslation();
  const [assigning, setAssigning] = useState(false);
  const today = indexes.todayIso;
  const horizon = upcomingDays(doc.settings);
  const dateFmt = dateFormat(doc.settings);
  const locale = currentLocale();
  // Hold just-completed tasks visible (at the bottom of their day) until this view
  // is left or refreshed, so a mis-click can be undone in place (#recover).
  const { held, onCompleted, onReopened } = useHeldCompletions(doc.tasks);
  const groups = buildGroups(indexes, today, horizon, held, t, dateFmt, locale);
  const seen = new Set<string>();
  let ghostCount = 0;
  const candidates: Task[] = [];
  for (const g of groups) for (const r of g.rows) {
    if (r.kind === "task") {
      if (!seen.has(r.task.id) && !isDone(r.task)) candidates.push(r.task);
      seen.add(r.task.id);
    } else ghostCount++;
  }
  const totalCount = seen.size + ghostCount;

  return (
    <section>
      <header className="view-header">
        <h1>{t("nav.upcoming")}</h1>
        <p className="view-sub">
          {t("upcoming.next", { count: horizon })} · {t("common.taskCount", { count: totalCount })}
          <IdleStatus tasks={doc.tasks} active={assigning}
                      onAssign={candidates.length > 0 ? () => setAssigning(a => !a) : undefined} />
        </p>
      </header>
      {assigning && (
        <AssignIdle tasks={doc.tasks} candidates={candidates} onClose={() => setAssigning(false)} />
      )}
      {groups.map(g => (
        <div key={g.date} className="upcoming-group">
          <h3 className="upcoming-day">{g.label}</h3>
          <RowList rows={g.rows} tags={indexes.tagsById} todayIso={today}
                   onCompleted={onCompleted} onReopened={onReopened} />
        </div>
      ))}
      {totalCount === 0 && (
        <p className="view-empty">{t("upcoming.empty", { count: horizon })}</p>
      )}
    </section>
  );
}

type Group = { date: string; label: string; rows: Row[] };

function buildGroups(
  indexes: Indexes,
  todayStr: string,
  horizon: number,
  held: Task[],
  t: TFunction,
  dateFmt: DateFormat,
  locale: string,
): Group[] {
  const today = dayjs(todayStr);
  const onDay = (t: Task, iso: string) => t.start_date === iso || t.due_date === iso;
  const result: Group[] = [];
  for (let i = 1; i <= horizon; i++) {
    const day = today.add(i, "day");
    const iso = day.format("YYYY-MM-DD");
    // Open tasks and recurring ghosts share this date, so order them together by
    // weight (a ghost lands where its promoted task would). Held completions for the
    // day are appended after, so they stay de-emphasised at the bottom.
    const open = indexes.tasks.filter(task => onDay(task, iso));
    const ghosts = indexes.ghostsForDate(iso);
    const heldForDay = held.filter(task => onDay(task, iso) && !open.some(a => a.id === task.id));
    const rows: Row[] = [
      ...indexes.mergeRowsByWeight(open, ghosts),
      ...heldForDay.map((task): Row => ({ kind: "task", task })),
    ];
    if (rows.length > 0) {
      result.push({ date: iso, label: labelFor(day, today, t, dateFmt, locale), rows });
    }
  }
  return result;
}

function labelFor(day: dayjs.Dayjs, today: dayjs.Dayjs, t: TFunction, dateFmt: DateFormat, locale: string): string {
  const diff = day.diff(today, "day");
  const date = formatIsoDate(day.format("YYYY-MM-DD"), dateFmt, locale);
  if (diff === 1) return `${t("upcoming.tomorrow")} · ${date}`;
  const weekdayStyle: Intl.DateTimeFormatOptions["weekday"] = diff < 7 ? "long" : "short";
  const weekday = day.toDate().toLocaleDateString(locale, { weekday: weekdayStyle });
  return `${weekday} · ${date}`;
}
