import dayjs from "dayjs";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { CalendarMonthLine } from "../components/calendar/CalendarMonthLine";
import { CalendarWeekRow } from "../components/calendar/CalendarWeekRow";
import { RowList } from "../components/RowList";
import { currentLocale } from "../i18n";
import {
  type CalendarMode,
  agendaRowsForDay,
  buildMonthGrid,
  buildWeekDays,
  monthChipSlice,
  shiftMonth,
  shiftWeek,
  weekStartIso,
} from "../lib/calendar";
import { addDaysIso, formatIsoDate } from "../lib/dates";
import type { DateFormat } from "../lib/dates";
import { dateFormat, firstDayOfWeek } from "../lib/settings";
import { useIsMobile } from "../lib/viewport";
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
  const isMobile = useIsMobile();
  const [mode, setMode] = useState<CalendarMode>("month");
  const [focusIso, setFocusIso] = useState(today);
  const [viewMonth, setViewMonth] = useState(() => today.slice(0, 7));
  const { held, onCompleted, onReopened } = useHeldCompletions(doc.tasks);

  const weekStart = weekStartIso(focusIso, fdow);
  const weekDays = useMemo(
    () => buildWeekDays(weekStart, indexes),
    [weekStart, indexes],
  );
  const monthWeeks = useMemo(
    () => buildMonthGrid(viewMonth, fdow, indexes),
    [viewMonth, fdow, indexes],
  );

  const dayRows = useMemo(() => {
    const base = agendaRowsForDay(indexes, focusIso);
    const onDay = (task: { start_date?: string; due_date?: string; id: string }) =>
      task.start_date === focusIso || task.due_date === focusIso;
    const heldForDay = held.filter(task => onDay(task) && !base.some(r => r.kind === "task" && r.task.id === task.id));
    return [...base, ...heldForDay.map(task => ({ kind: "task" as const, task }))];
  }, [indexes, focusIso, held]);

  const goDay = (iso: string) => {
    setFocusIso(iso);
    setViewMonth(iso.slice(0, 7));
    setMode("day");
  };

  const jumpToday = () => {
    setFocusIso(today);
    setViewMonth(today.slice(0, 7));
  };

  const periodLabel = mode === "month"
    ? formatMonthTitle(viewMonth, locale, t)
    : mode === "week"
      ? formatWeekRange(weekStart, locale, t)
      : formatDayTitle(focusIso, today, t, dateFmt, locale);

  const prevPeriod = () => {
    if (mode === "month") setViewMonth(m => shiftMonth(m, -1));
    else if (mode === "week") setFocusIso(iso => shiftWeek(iso, -1));
    else setFocusIso(iso => addDaysIso(iso, -1));
  };

  const nextPeriod = () => {
    if (mode === "month") setViewMonth(m => shiftMonth(m, 1));
    else if (mode === "week") setFocusIso(iso => shiftWeek(iso, 1));
    else setFocusIso(iso => addDaysIso(iso, 1));
  };

  const todayLabel = mode === "week" ? t("calendar.thisWeek") : t("calendar.today");
  const prevAria = mode === "month" ? t("calendar.prevMonth")
    : mode === "week" ? t("calendar.prevWeek") : t("calendar.prevDay");
  const nextAria = mode === "month" ? t("calendar.nextMonth")
    : mode === "week" ? t("calendar.nextWeek") : t("calendar.nextDay");

  const showNarrowWeek = isMobile && mode === "week";

  return (
    <section className="calendar-view">
      <header className="view-header calendar-header">
        <h1>{t("nav.calendar")}</h1>
        <div className="calendar-header-controls">
          <div className="te-segmented calendar-mode-toggle" role="group" aria-label={t("calendar.modeAria")}>
            {(["month", "week", "day"] as CalendarMode[]).map(m => (
              <button
                key={m}
                type="button"
                className={mode === m ? "active" : undefined}
                aria-pressed={mode === m}
                onClick={() => setMode(m)}
              >
                {t(`calendar.mode${m.charAt(0).toUpperCase()}${m.slice(1)}`)}
              </button>
            ))}
          </div>
          <div className="calendar-period-nav">
            <button type="button" className="calendar-nav-btn" aria-label={prevAria} onClick={prevPeriod}>‹</button>
            <span className="calendar-period-label">{periodLabel}</span>
            <button type="button" className="calendar-nav-btn" aria-label={nextAria} onClick={nextPeriod}>›</button>
            <button type="button" className="calendar-today-btn" onClick={jumpToday}>{todayLabel}</button>
          </div>
        </div>
      </header>

      {mode === "month" && (
        <div className="calendar-month" role="grid" aria-label={t("calendar.gridAria")}>
          <div className="calendar-weekdays" role="row">
            {Array.from({ length: 7 }, (_, i) => WEEKDAY_KEYS[(fdow + i) % 7]).map((key, i) => (
              <span key={i} className="calendar-weekday" role="columnheader">{t(key).slice(0, 1)}</span>
            ))}
          </div>
          {monthWeeks.map((week, wi) => (
            <div key={wi} className="calendar-month-week" role="row">
              {week.map(cell => {
                const rows = agendaRowsForDay(indexes, cell.iso);
                const { visible, overflow } = monthChipSlice(rows);
                const isToday = cell.iso === today;
                return (
                  <div
                    key={cell.iso}
                    role="gridcell"
                    className={[
                      "calendar-month-cell",
                      !cell.inMonth && "calendar-month-cell-out",
                      isToday && "calendar-month-cell-today",
                    ].filter(Boolean).join(" ")}
                  >
                    <button
                      type="button"
                      className="calendar-month-daynum"
                      onClick={() => goDay(cell.iso)}
                      aria-label={formatIsoDate(cell.iso, dateFmt, locale)}
                    >
                      {cell.day}
                    </button>
                    <div className="calendar-month-lines">
                      {visible.map(row => (
                        <CalendarMonthLine
                          key={row.kind === "task" ? row.task.id : row.ghost.id}
                          row={row}
                          tags={indexes.tagsById}
                        />
                      ))}
                      {overflow > 0 && (
                        <button type="button" className="calendar-more-link" onClick={() => goDay(cell.iso)}>
                          {t("calendar.moreItems", { count: overflow })}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {mode === "week" && !showNarrowWeek && (
        <div className="calendar-week-grid" role="grid" aria-label={t("calendar.weekAria")}>
          {weekDays.map(cell => {
            const rows = agendaRowsForDay(indexes, cell.iso);
            const isToday = cell.iso === today;
            const weekday = dayjs(cell.iso).toDate().toLocaleDateString(locale, { weekday: "short" });
            return (
              <div key={cell.iso} className="calendar-week-col" role="gridcell">
                <button type="button" className="calendar-week-col-head" onClick={() => goDay(cell.iso)}>
                  <span className="calendar-week-col-weekday">
                    {weekday}{isToday ? ` · ${t("calendar.todayShort")}` : ""}
                  </span>
                  <span className={`calendar-week-col-day${isToday ? " calendar-week-col-day-today" : ""}`}>
                    {cell.day}
                  </span>
                  <span className="calendar-week-col-count">
                    {t("common.taskCount", { count: rows.length })}
                  </span>
                </button>
                <div className="calendar-week-col-body">
                  {rows.length === 0
                    ? <span className="calendar-week-empty" aria-hidden="true">—</span>
                    : rows.map(row => (
                      <CalendarWeekRow
                        key={row.kind === "task" ? row.task.id : row.ghost.id}
                        row={row}
                        tags={indexes.tagsById}
                        todayIso={today}
                        settings={doc.settings}
                      />
                    ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showNarrowWeek && (
        <>
          <CalendarDayStrip
            days={weekDays}
            focusIso={focusIso}
            todayIso={today}
            fdow={fdow}
            t={t}
            onSelect={setFocusIso}
          />
          <div className="calendar-narrow-agenda">
            <RowList rows={agendaRowsForDay(indexes, focusIso)} tags={indexes.tagsById} todayIso={today}
                     settings={doc.settings} hideTimer emptyText={t("calendar.empty")}
                     onCompleted={onCompleted} onReopened={onReopened} />
          </div>
        </>
      )}

      {mode === "day" && (
        <div className="calendar-day">
          {isMobile && (
            <CalendarDayStrip
              days={weekDays}
              focusIso={focusIso}
              todayIso={today}
              fdow={fdow}
              t={t}
              onSelect={setFocusIso}
            />
          )}
          <header className="calendar-day-header">
            <h2>{formatDayTitle(focusIso, today, t, dateFmt, locale)}</h2>
            <span className="calendar-day-count">{t("common.taskCount", { count: dayRows.length })}</span>
          </header>
          <RowList rows={dayRows} tags={indexes.tagsById} todayIso={today} settings={doc.settings}
                   hideTimer emptyText={t("calendar.empty")}
                   onCompleted={onCompleted} onReopened={onReopened} />
        </div>
      )}
    </section>
  );
}

type StripProps = {
  days: { iso: string; day: number }[];
  focusIso: string;
  todayIso: string;
  fdow: number;
  t: TFunction;
  onSelect: (iso: string) => void;
};

function CalendarDayStrip({ days, focusIso, todayIso, fdow, t, onSelect }: StripProps) {
  return (
    <div className="calendar-day-strip" role="tablist" aria-label={t("calendar.dayStripAria")}>
      {days.map((cell, i) => {
        const weekday = t(WEEKDAY_KEYS[(fdow + i) % 7]).slice(0, 1);
        const selected = cell.iso === focusIso;
        const isToday = cell.iso === todayIso;
        return (
          <button
            key={cell.iso}
            type="button"
            role="tab"
            aria-selected={selected}
            className={[
              "calendar-day-strip-btn",
              selected && "calendar-day-strip-btn-active",
              isToday && "calendar-day-strip-btn-today",
            ].filter(Boolean).join(" ")}
            onClick={() => onSelect(cell.iso)}
          >
            <span className="calendar-day-strip-weekday">{weekday}</span>
            <span className="calendar-day-strip-num">{cell.day}</span>
          </button>
        );
      })}
    </div>
  );
}

function formatMonthTitle(yearMonth: string, locale: string, t: TFunction): string {
  const [y, m] = yearMonth.split("-").map(Number);
  const monthsShort = t("taskEditor.monthsShort", { returnObjects: true }) as string[];
  const monthLabel = monthsShort[m - 1] ?? String(m);
  if (locale.startsWith("zh")) return `${y}年${monthLabel}`;
  return `${monthLabel} ${y}`;
}

function formatWeekRange(weekStart: string, locale: string, t: TFunction): string {
  const end = addDaysIso(weekStart, 6);
  if (locale.startsWith("zh")) {
    const s = dayjs(weekStart);
    const e = dayjs(end);
    return `${s.month() + 1}月${s.date()}日 – ${e.month() + 1}月${e.date()}日`;
  }
  const s = formatIsoDate(weekStart, "month_day_year", locale);
  const e = formatIsoDate(end, "month_day_year", locale);
  return t("calendar.weekRange", { start: s, end: e });
}

function formatDayTitle(
  iso: string,
  todayIso: string,
  t: TFunction,
  dateFmt: DateFormat,
  locale: string,
): string {
  const day = dayjs(iso);
  const weekday = day.toDate().toLocaleDateString(locale, { weekday: "short" });
  const base = locale.startsWith("zh")
    ? `${day.month() + 1}月${day.date()}日 (${weekday})`
    : `${formatIsoDate(iso, dateFmt, locale)} (${weekday})`;
  if (iso === todayIso) return `${base} · ${t("calendar.today")}`;
  return base;
}
