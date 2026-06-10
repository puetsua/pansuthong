import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Document, Task } from "../lib/tauri";
import { TaskList } from "../components/TaskList";
import { Indexes } from "../state/indexes";
import { addDaysIso, logicalDayOf } from "../lib/dates";
import { dayStartHour } from "../lib/settings";

type Props = { doc: Document; indexes: Indexes };

// Page sizes offered for the archived list (#92).
const PAGE_SIZES = [10, 30, 50] as const;
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

  const [query, setQuery] = useState("");
  const [dateField, setDateField] = useState<DateField>("completed");
  const [from, setFrom] = useState(() => addDaysIso(today, -DEFAULT_RANGE_DAYS));
  const [to, setTo] = useState(() => today);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZES[0]);
  const [page, setPage] = useState(1); // 1-based

  const trimmed = query.trim();
  const filtering = trimmed !== "" || from !== "" || to !== "";
  // A bounded range running backwards matches nothing; flag it instead of
  // silently showing an empty list.
  const invalidRange = from !== "" && to !== "" && from > to;

  const filtered = useMemo(() => {
    // With no search and no date bound, the archive could be enormous — require
    // an active filter before listing anything.
    if (!filtering) return [];
    const q = trimmed.toLowerCase();
    return archived.filter(t => {
      if (q && !(t.title.toLowerCase().includes(q) || t.notes.toLowerCase().includes(q))) return false;
      if (from || to) {
        const d = taskDate(t, dateField, dsh);
        if (!d) return false; // no date for this field can't sit in a bounded range
        if (from && d < from) return false;
        if (to && d > to) return false;
      }
      return true;
    });
  }, [archived, filtering, trimmed, dateField, from, to, dsh]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  // Clamp: the list can shrink under the current page when a filter narrows it
  // or a task is restored away.
  const current = Math.min(page, totalPages);
  const start = (current - 1) * pageSize;
  const pageItems = filtered.slice(start, start + pageSize);

  // Any change that reshapes the result set sends the reader back to page 1.
  const reset = () => setPage(1);
  const onQuery = (v: string) => { setQuery(v); reset(); };
  const onDateField = (v: DateField) => { setDateField(v); reset(); };
  const onFrom = (v: string) => { setFrom(v); reset(); };
  const onTo = (v: string) => { setTo(v); reset(); };
  const onPageSize = (v: number) => { setPageSize(v); reset(); };
  const clearDates = () => { setFrom(""); setTo(""); reset(); };

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
        <label className="archived-filter">
          <span>{t("common.from")}</span>
          <input type="date" aria-label={t("common.fromDate")} value={from} max={to || undefined}
                 onChange={e => onFrom(e.currentTarget.value)} />
        </label>
        <label className="archived-filter">
          <span>{t("common.to")}</span>
          <input type="date" aria-label={t("common.toDate")} value={to} min={from || undefined}
                 onChange={e => onTo(e.currentTarget.value)} />
        </label>
        {(from || to) && (
          <button type="button" className="archived-clear" onClick={clearDates}>{t("common.clearDates")}</button>
        )}
      </div>

      {invalidRange && (
        <p className="composer-error" role="alert">{t("archived.invalidRange")}</p>
      )}

      <TaskList tasks={pageItems} tags={indexes.tagsById} todayIso={today}
                emptyText={filtering ? t("archived.emptyFiltered") : t("archived.emptyAll")}
                archived />

      {totalPages > 1 && (
        <div className="pagination">
          <button type="button" className="pagination-btn" aria-label={t("common.previousPage")}
                  disabled={current <= 1} onClick={() => setPage(current - 1)}>
            {t("common.prev")}
          </button>
          <span className="pagination-status">{t("common.pageStatus", { current, total: totalPages })}</span>
          <button type="button" className="pagination-btn" aria-label={t("common.nextPage")}
                  disabled={current >= totalPages} onClick={() => setPage(current + 1)}>
            {t("common.next")}
          </button>
        </div>
      )}

      <label className="pagination-size">
        {t("common.perPage")}{" "}
        <select aria-label={t("archived.perPageAria")} value={pageSize}
                onChange={e => onPageSize(Number(e.currentTarget.value))}>
          {PAGE_SIZES.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
    </section>
  );
}
