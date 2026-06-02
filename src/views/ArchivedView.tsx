import { useMemo, useState } from "react";
import { Document, Task } from "../lib/tauri";
import { TaskList } from "../components/TaskList";
import { Indexes } from "../state/indexes";
import { todayIso, addDaysIso } from "../lib/dates";

type Props = { doc: Document; indexes: Indexes };

// Page sizes offered for the archived list (#92).
const PAGE_SIZES = [10, 30, 50] as const;
// On entry, show only today's completions; the reader widens via the date inputs
// or "Clear dates".
const DEFAULT_RANGE_DAYS = 0;

type DateField = "completed" | "due" | "created";

// The YYYY-MM-DD a task carries for the chosen field, or undefined if it has none.
function taskDate(t: Task, field: DateField): string | undefined {
  if (field === "due") return t.due_date;
  if (field === "created") return t.created_at?.slice(0, 10);
  return t.completed_at?.slice(0, 10);
}

export function ArchivedView({ indexes }: Props) {
  const archived = indexes.archived;
  const today = todayIso();

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
        const d = taskDate(t, dateField);
        if (!d) return false; // no date for this field can't sit in a bounded range
        if (from && d < from) return false;
        if (to && d > to) return false;
      }
      return true;
    });
  }, [archived, filtering, trimmed, dateField, from, to]);

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
          <h1>Archived</h1>
        </div>
        <p className="view-sub">
          {filtering
            ? `${filtered.length} of ${archived.length} archived match the filter`
            : `${archived.length} archived · search or pick a date range to list them`}
        </p>
      </header>

      <input
        className="search-input"
        value={query}
        onChange={e => onQuery(e.currentTarget.value)}
        placeholder="Search archived…"
        aria-label="Search archived tasks"
      />

      <div className="archived-filters">
        <label className="archived-filter">
          <span>Date</span>
          <select aria-label="Date field" value={dateField}
                  onChange={e => onDateField(e.currentTarget.value as DateField)}>
            <option value="completed">Completed</option>
            <option value="due">Due</option>
            <option value="created">Created</option>
          </select>
        </label>
        <label className="archived-filter">
          <span>From</span>
          <input type="date" aria-label="From date" value={from} max={to || undefined}
                 onChange={e => onFrom(e.currentTarget.value)} />
        </label>
        <label className="archived-filter">
          <span>To</span>
          <input type="date" aria-label="To date" value={to} min={from || undefined}
                 onChange={e => onTo(e.currentTarget.value)} />
        </label>
        {(from || to) && (
          <button type="button" className="archived-clear" onClick={clearDates}>Clear dates</button>
        )}
      </div>

      {invalidRange && (
        <p className="composer-error" role="alert">“To” date can’t be earlier than “From” date.</p>
      )}

      <TaskList tasks={pageItems} tags={indexes.tagsById} todayIso={today}
                emptyText={filtering ? "No archived tasks match the filter." : "Search or pick a date range to list archived tasks."}
                archived />

      {totalPages > 1 && (
        <div className="pagination">
          <button type="button" className="pagination-btn" aria-label="Previous page"
                  disabled={current <= 1} onClick={() => setPage(current - 1)}>
            ‹ Prev
          </button>
          <span className="pagination-status">Page {current} of {totalPages}</span>
          <button type="button" className="pagination-btn" aria-label="Next page"
                  disabled={current >= totalPages} onClick={() => setPage(current + 1)}>
            Next ›
          </button>
        </div>
      )}

      <label className="pagination-size">
        Per page{" "}
        <select aria-label="Tasks per page" value={pageSize}
                onChange={e => onPageSize(Number(e.currentTarget.value))}>
          {PAGE_SIZES.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
    </section>
  );
}
