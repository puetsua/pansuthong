import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Document, Task } from "../lib/tauri";
import { IdleStatus } from "../components/IdleStatus";
import { DateRangeFilters, PageSizeSelect, PaginationControls } from "../components/ListControls";
import { usePagedItems } from "../lib/listPaging";
import { taskMatchesQuery } from "../lib/taskSearch";
import { TaskList } from "../components/TaskList";
import { Indexes } from "../state/indexes";
import { addDaysIso, logicalDayOf } from "../lib/dates";
import { dayStartHour } from "../lib/settings";
import { useIdleAnchor } from "../lib/useIdleAnchor";

type Props = { doc: Document; indexes: Indexes };

// On entry, show only today's completions; the reader widens via the date inputs
// or "Clear dates".
const DEFAULT_RANGE_DAYS = 0;

type DateField = "completed" | "due" | "created";

// The YYYY-MM-DD a task carries for the chosen field, or undefined if it has none.
// Timestamp fields (completed/created) map to their logical day so the default
// "today" window lines up with the day-start rollover used elsewhere (a 00:05
// completion under a 3am start still counts as the previous day, matching Today).
function taskDate(t: Task, field: DateField, dsh: number): string | undefined {
  if (field === "due") return t.due_date;
  if (field === "created") return t.created_at ? logicalDayOf(t.created_at, dsh) : undefined;
  return t.completed_at ? logicalDayOf(t.completed_at, dsh) : undefined;
}

export function ArchivedView({ doc, indexes }: Props) {
  const { t } = useTranslation();
  const archived = indexes.archived;
  const today = indexes.todayIso;
  const dsh = dayStartHour(doc.settings);
  const { idleAnchorMs } = useIdleAnchor();

  const [query, setQuery] = useState("");
  const [dateField, setDateField] = useState<DateField>("completed");
  const [from, setFrom] = useState(() => addDaysIso(today, -DEFAULT_RANGE_DAYS));
  const [to, setTo] = useState(() => today);

  const trimmed = query.trim();
  const filtering = trimmed !== "" || from !== "" || to !== "";
  // A bounded range running backwards matches nothing; flag it instead of
  // silently showing an empty list.
  const invalidRange = from !== "" && to !== "" && from > to;

  const filtered = useMemo(() => {
    // With no search and no date bound, the archive could be enormous — require
    // an active filter before listing anything.
    if (!filtering) return [];
    return archived.filter(t => {
      if (trimmed && !taskMatchesQuery(t, trimmed, indexes.tagsById)) return false;
      if (from || to) {
        const d = taskDate(t, dateField, dsh);
        if (!d) return false; // no date for this field can't sit in a bounded range
        if (from && d < from) return false;
        if (to && d > to) return false;
      }
      return true;
    });
  }, [archived, filtering, trimmed, dateField, from, to, dsh, indexes.tagsById]);

  const {
    pageSize,
    setPageSize,
    page: current,
    setPage,
    totalPages,
    pageItems,
    resetPage,
  } = usePagedItems(filtered);

  // Any change that reshapes the result set sends the reader back to page 1.
  const onQuery = (v: string) => { setQuery(v); resetPage(); };
  const onDateField = (v: DateField) => { setDateField(v); resetPage(); };
  const onFrom = (v: string) => { setFrom(v); resetPage(); };
  const onTo = (v: string) => { setTo(v); resetPage(); };
  const clearDates = () => { setFrom(""); setTo(""); resetPage(); };

  return (
    <section>
      <header className="view-header">
        <div className="view-title-row">
          <h1>{t("nav.archived")}</h1>
        </div>
        <p className="view-sub">
          {filtering
            ? t("archived.subtitleFiltered", { shown: filtered.length, total: archived.length })
            : t("archived.subtitleAll", { total: archived.length })}
          <IdleStatus tasks={doc.tasks} idleAnchorMs={idleAnchorMs} />
        </p>
      </header>

      <input
        className="search-input"
        value={query}
        onChange={e => onQuery(e.currentTarget.value)}
        placeholder={t("archived.searchPlaceholder")}
        aria-label={t("archived.searchAria")}
      />

      <div className="archived-filters">
        <label className="archived-filter">
          <span>{t("archived.date")}</span>
          <select aria-label={t("archived.dateField")} value={dateField}
                  onChange={e => onDateField(e.currentTarget.value as DateField)}>
            <option value="completed">{t("archived.completed")}</option>
            <option value="due">{t("archived.due")}</option>
            <option value="created">{t("archived.created")}</option>
          </select>
        </label>
        <DateRangeFilters
          from={from}
          to={to}
          fromLabel={t("common.from")}
          toLabel={t("common.to")}
          fromAriaLabel={t("common.fromDate")}
          toAriaLabel={t("common.toDate")}
          clearLabel={t("common.clearDates")}
          onFromChange={onFrom}
          onToChange={onTo}
          onClear={clearDates}
        />
      </div>

      {invalidRange && (
        <p className="composer-error" role="alert">{t("archived.invalidRange")}</p>
      )}

      <TaskList tasks={pageItems} tags={indexes.tagsById} todayIso={today}
                emptyText={filtering ? t("archived.emptyFiltered") : t("archived.emptyAll")}
                archived />

      <PaginationControls
        current={current}
        totalPages={totalPages}
        previousLabel={t("common.prev")}
        nextLabel={t("common.next")}
        previousAriaLabel={t("common.previousPage")}
        nextAriaLabel={t("common.nextPage")}
        status={t("common.pageStatus", { current, total: totalPages })}
        onPageChange={setPage}
      />

      <PageSizeSelect
        label={t("common.perPage")}
        ariaLabel={t("archived.perPageAria")}
        value={pageSize}
        onChange={setPageSize}
      />
    </section>
  );
}
