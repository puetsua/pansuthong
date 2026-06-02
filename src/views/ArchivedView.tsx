import { useMemo, useState } from "react";
import { Document } from "../lib/tauri";
import { TaskList } from "../components/TaskList";
import { Indexes } from "../state/indexes";
import { todayIso } from "../lib/dates";

type Props = { doc: Document; indexes: Indexes };

// Page sizes offered for the archived list (#92).
const PAGE_SIZES = [10, 30, 50] as const;

export function ArchivedView({ indexes }: Props) {
  const archived = indexes.archived;
  const [query, setQuery] = useState("");
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZES[0]);
  const [page, setPage] = useState(1); // 1-based

  const trimmed = query.trim();
  const filtered = useMemo(() => {
    const q = trimmed.toLowerCase();
    if (!q) return archived;
    return archived.filter(t => t.title.toLowerCase().includes(q) || t.notes.toLowerCase().includes(q));
  }, [archived, trimmed]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  // Clamp: the list can shrink under the current page when a query narrows it
  // or a task is restored away.
  const current = Math.min(page, totalPages);
  const start = (current - 1) * pageSize;
  const pageItems = filtered.slice(start, start + pageSize);

  // Any change that reshapes the result set sends the reader back to page 1.
  const onQuery = (v: string) => { setQuery(v); setPage(1); };
  const onPageSize = (v: number) => { setPageSize(v); setPage(1); };

  return (
    <section>
      <header className="view-header">
        <div className="view-title-row">
          <h1>Archived</h1>
        </div>
        <p className="view-sub">
          {trimmed
            ? `${filtered.length} of ${archived.length} archived match “${trimmed}”`
            : `${archived.length} archived · Restore brings a task back to the active lists`}
        </p>
      </header>

      <input
        className="search-input"
        value={query}
        onChange={e => onQuery(e.currentTarget.value)}
        placeholder="Search archived…"
        aria-label="Search archived tasks"
      />

      <TaskList tasks={pageItems} tags={indexes.tagsById} todayIso={todayIso()}
                emptyText={trimmed ? "No archived tasks match your search." : "No archived tasks yet."}
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
