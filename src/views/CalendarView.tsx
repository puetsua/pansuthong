import dayjs from "dayjs";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { RowList } from "../components/RowList";
import { currentLocale } from "../i18n";
import {
  agendaRowsForDay,
  buildMonthGrid,
  calendarDots,
  shiftMonth,
} from "../lib/calendar";
import { formatIsoDate } from "../lib/dates";
import { dateFormat, firstDayOfWeek } from "../lib/settings";
import type { DateFormat } from "../lib/dates";
import { Document } from "../lib/tauri";
import { Indexes } from "../state/indexes";
import { useHeldCompletions } from "../state/heldCompletions";

type Props = { doc: Document; indexes: Indexes };

const WEEKDAY_KEYS = [
  "taskEditor.weekdaySun", "taskEditor.weekdayMon", "taskEditor.weekdayTue",
  "taskEditor.weekdayWed", "taskEditor.weekdayThu", "taskEditor.weekdayFri",
  "taskEditor.weekdaySat",
];

export function CalendarView({ doc, indexes }: Props) {
  const { t } = useTranslation();
  const today = indexes.todayIso;
  const fdow = firstDayOfWeek(doc.settings);
  const dateFmt = dateFormat(doc.settings);
  const locale = currentLocale();
  const [viewMonth, setViewMonth] = useState(() => today.slice(0, 7));
  const [selectedIso, setSelectedIso] = useState(today);
  const { held, onCompleted, onReopened } = useHeldCompletions(doc.tasks);

  const weeks = useMemo(
    () => buildMonthGrid(viewMonth, fdow, indexes),
    [viewMonth, fdow, indexes],
  );

  const rows = useMemo(() => {
    const base = agendaRowsForDay(indexes, selectedIso);
    const onDay = (iso: string) => (task: { start_date?: string; due_date?: string; id: string }) =>
      task.start_date === iso || task.due_date === iso;
    const heldForDay = held.filter(task => onDay(selectedIso)(task) && !base.some(r => r.kind === "task" && r.task.id === task.id));
    return [...base, ...heldForDay.map(task => ({ kind: "task" as const, task }))];
  }, [indexes, selectedIso, held]);

  const monthTitle = formatMonthTitle(viewMonth, locale, t);
  const agendaLabel = agendaHeaderLabel(selectedIso, today, t, dateFmt, locale);

  return (
    <section className="calendar-view">
      <header className="view-header">
        <h1>{t("nav.calendar")}</h1>
        <p className="view-sub">{t("calendar.hint")}</p>
      </header>

      <div className="calendar-toolbar">
        <div className="calendar-month-nav">
          <button type="button" className="calendar-nav-btn" aria-label={t("calendar.prevMonth")}
                  onClick={() => setViewMonth(m => shiftMonth(m, -1))}>‹</button>
          <span className="calendar-month-title">{monthTitle}</span>
          <button type="button" className="calendar-nav-btn" aria-label={t("calendar.nextMonth")}
                  onClick={() => setViewMonth(m => shiftMonth(m, 1))}>›</button>
        </div>
        <button type="button" className="calendar-today-btn"
                onClick={() => { setViewMonth(today.slice(0, 7)); setSelectedIso(today); }}>
          {t("calendar.today")}
        </button>
      </div>

      <div className="calendar-grid" role="grid" aria-label={t("calendar.gridAria")}>
        <div className="calendar-weekdays" role="row">
          {Array.from({ length: 7 }, (_, i) => WEEKDAY_KEYS[(fdow + i) % 7]).map((key, i) => (
            <span key={i} className="calendar-weekday" role="columnheader">{t(key).slice(0, 1)}</span>
          ))}
        </div>
        {weeks.map((week, wi) => (
          <div key={wi} className="calendar-week" role="row">
            {week.map(cell => {
              const selected = cell.iso === selectedIso;
              const isToday = cell.iso === today;
              const dots = calendarDots(cell.summary);
              const count = cell.summary.totalCount;
              return (
                <button
                  key={cell.iso}
                  type="button"
                  role="gridcell"
                  aria-pressed={selected}
                  aria-label={t("calendar.dayAria", { date: formatIsoDate(cell.iso, dateFmt, locale), count })}
                  className={[
                    "calendar-day",
                    !cell.inMonth && "calendar-day-out",
                    selected && "calendar-day-selected",
                    isToday && "calendar-day-today",
                  ].filter(Boolean).join(" ")}
                  onClick={() => setSelectedIso(cell.iso)}
                >
                  {count > 0 && <span className="calendar-day-badge">{count}</span>}
                  <span className="calendar-day-num">{cell.day}</span>
                  {dots.length > 0 && (
                    <span className="calendar-day-dots" aria-hidden="true">
                      {dots.map((d, i) => (
                        <span key={i} className={d.kind === "ghost" ? "calendar-dot calendar-dot-ghost" : "calendar-dot"} />
                      ))}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <ul className="calendar-legend" aria-label={t("calendar.legendAria")}>
        <li><span className="calendar-dot" aria-hidden="true" />{t("calendar.legendTask")}</li>
        <li><span className="calendar-dot calendar-dot-ghost" aria-hidden="true" />{t("calendar.legendGhost")}</li>
        <li>{t("calendar.legendBadge")}</li>
      </ul>

      <div className="calendar-agenda">
        <header className="calendar-agenda-header">
          <h2>{agendaLabel}</h2>
          <span className="calendar-agenda-count">{t("common.taskCount", { count: rows.length })}</span>
        </header>
        <RowList rows={rows} tags={indexes.tagsById} todayIso={today} settings={doc.settings}
                 emptyText={t("calendar.empty")} onCompleted={onCompleted} onReopened={onReopened} />
      </div>
    </section>
  );
}

function formatMonthTitle(yearMonth: string, locale: string, t: TFunction): string {
  const [y, m] = yearMonth.split("-").map(Number);
  const monthsShort = t("taskEditor.monthsShort", { returnObjects: true }) as string[];
  const monthLabel = monthsShort[m - 1] ?? String(m);
  if (locale.startsWith("zh")) return `${y}年${monthLabel}`;
  return `${monthLabel} ${y}`;
}

function agendaHeaderLabel(
  iso: string,
  todayIso: string,
  t: TFunction,
  dateFmt: DateFormat,
  locale: string,
): string {
  const day = dayjs(iso);
  const date = formatIsoDate(iso, dateFmt, locale);
  const weekday = day.toDate().toLocaleDateString(locale, { weekday: "short" });
  const base = locale.startsWith("zh")
    ? `${day.month() + 1}月${day.date()}日 (${weekday})`
    : `${date} (${weekday})`;
  if (iso === todayIso) return `${base} · ${t("calendar.today")}`;
  return base;
}
