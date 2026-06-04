import { useEffect, useMemo, useState } from "react";
import { api, HistoryEntry } from "../lib/tauri";
import { errorMessage } from "../lib/errors";

const PAGE_SIZES = [10, 30, 50] as const;

function formatTime(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function entityLabel(entry: HistoryEntry): string {
  if (entry.entity === "tag") return entry.title;
  if (entry.entity === "template") return `Template: ${entry.title}`;
  return entry.title;
}

function entryDate(entry: HistoryEntry): string {
  return entry.timestamp.slice(0, 10);
}

function entryMatches(entry: HistoryEntry, query: string): boolean {
  if (!query) return true;
  const haystack = [
    entry.title,
    entry.summary,
    entry.entity,
    entry.event,
    entry.entity_id,
  ].join(" ").toLowerCase();
  return haystack.includes(query);
}

export function HistoryView() {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZES[0]);
  const [page, setPage] = useState(1);

  useEffect(() => {
    let mounted = true;
    void api.listHistory()
      .then((items) => {
        if (!mounted) return;
        setEntries(items);
        setError(null);
      })
      .catch((e) => {
        if (mounted) setError(errorMessage(e));
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => { mounted = false; };
  }, []);

  const trimmed = query.trim().toLowerCase();
  const filtering = trimmed !== "" || from !== "" || to !== "";
  const invalidRange = from !== "" && to !== "" && from > to;

  const filtered = useMemo(() => {
    return entries.filter(entry => {
      if (!entryMatches(entry, trimmed)) return false;
      if (from || to) {
        const d = entryDate(entry);
        if (from && d < from) return false;
        if (to && d > to) return false;
      }
      return true;
    });
  }, [entries, trimmed, from, to]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const current = Math.min(page, totalPages);
  const start = (current - 1) * pageSize;
  const pageItems = filtered.slice(start, start + pageSize);

  const reset = () => setPage(1);
  const onQuery = (v: string) => { setQuery(v); reset(); };
  const onFrom = (v: string) => { setFrom(v); reset(); };
  const onTo = (v: string) => { setTo(v); reset(); };
  const onPageSize = (v: number) => { setPageSize(v); reset(); };
  const clearDates = () => { setFrom(""); setTo(""); reset(); };

  return (
    <section>
      <header className="view-header">
        <div className="view-title-row">
          <h1>History</h1>
        </div>
        <p className="view-sub">
          {entries.length > 0
            ? filtering
              ? `${filtered.length} of ${entries.length} changes match the filter`
              : `${entries.length} changes`
            : "Recent task, tag, and template changes"}
        </p>
      </header>

      <input
        className="search-input"
        value={query}
        onChange={e => onQuery(e.currentTarget.value)}
        placeholder="Search history..."
        aria-label="Search history"
      />

      <div className="archived-filters">
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
        <p className="composer-error" role="alert">"To" date can't be earlier than "From" date.</p>
      )}

      {loading && <p className="view-empty">Loading history...</p>}
      {error && <p className="composer-error" role="alert">Failed to load history: {error}</p>}
      {!loading && !error && entries.length === 0 && (
        <p className="view-empty">No history recorded yet.</p>
      )}
      {!loading && !error && entries.length > 0 && (
        <>
          {pageItems.length === 0 ? (
            <p className="view-empty">No history entries match the filter.</p>
          ) : (
            <ol className="history-list">
              {pageItems.map((entry, index) => (
                <li className="history-row" key={`${entry.timestamp}-${entry.event}-${entry.entity_id}-${start + index}`}>
                  <div className="history-main">
                    <span className="history-summary">{entry.summary}</span>
                    <span className="history-title">{entityLabel(entry)}</span>
                  </div>
                  <time className="history-time" dateTime={entry.timestamp}>{formatTime(entry.timestamp)}</time>
                </li>
              ))}
            </ol>
          )}

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
            <select aria-label="History entries per page" value={pageSize}
                    onChange={e => onPageSize(Number(e.currentTarget.value))}>
              {PAGE_SIZES.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        </>
      )}
    </section>
  );
}
