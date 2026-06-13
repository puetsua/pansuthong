import dayjs from "dayjs";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { GhostRow } from "../components/GhostRow";
import { TaskList } from "../components/TaskList";
import { effectivePriority, Indexes } from "../state/indexes";
import { useHeldCompletions } from "../state/heldCompletions";
import { Document, Task } from "../lib/tauri";
import { GhostTask } from "../lib/recurrence";
import { dateFormat, upcomingDays } from "../lib/settings";
import { currentLocale } from "../i18n";
import { formatIsoDate } from "../lib/dates";
import type { DateFormat } from "../lib/dates";

type Props = { doc: Document; indexes: Indexes };

export function UpcomingView({ doc, indexes }: Props) {
  const { t } = useTranslation();
  const today = indexes.todayIso;
  const horizon = upcomingDays(doc.settings);
  const dateFmt = dateFormat(doc.settings);
  const locale = currentLocale();
  // Hold just-completed tasks visible (at the bottom of their day) until this view
  // is left or refreshed, so a mis-click can be undone in place (#recover).
  const { held, onCompleted, onReopened } = useHeldCompletions(doc.tasks);
  const groups = buildGroups(indexes, today, horizon, held, t, dateFmt, locale);
  const totalCount =
    new Set(groups.flatMap(g => g.tasks.map(t => t.id))).size +
    groups.reduce((n, g) => n + g.ghosts.length, 0);

  return (
    <section>
      <header className="view-header">
        <h1>{t("nav.upcoming")}</h1>
        <p className="view-sub">{t("upcoming.next", { count: horizon })} · {t("common.taskCount", { count: totalCount })}</p>
      </header>
      {groups.map(g => (
        <div key={g.date} className="upcoming-group">
          <h3 className="upcoming-day">{g.label}</h3>
          {g.ghosts.map(gh => <GhostRow key={gh.id} ghost={gh} tags={indexes.tagsById} />)}
          {g.tasks.length > 0 && (
            <TaskList tasks={g.tasks} tags={indexes.tagsById} todayIso={today}
                      onCompleted={onCompleted} onReopened={onReopened} />
          )}
        </div>
      ))}
      {totalCount === 0 && (
        <p className="view-empty">{t("upcoming.empty", { count: horizon })}</p>
      )}
    </section>
  );
}

type Group = { date: string; label: string; tasks: Task[]; ghosts: GhostTask[] };

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
    // All tasks in a group share this date, so order them by priority (weight desc),
    // then append any held completions for that day (they sort to the bottom).
    const tasks = indexes.tasks
      .filter(t => onDay(t, iso))
      .sort((a, b) => effectivePriority(b, indexes.tagsById) - effectivePriority(a, indexes.tagsById));
    const heldForDay = held.filter(t => onDay(t, iso) && !tasks.some(a => a.id === t.id));
    const all = [...tasks, ...heldForDay];
    const ghosts = indexes.ghostsForDate(iso);
    if (all.length > 0 || ghosts.length > 0) {
      result.push({ date: iso, label: labelFor(day, today, t, dateFmt, locale), tasks: all, ghosts });
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
