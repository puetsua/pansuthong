import { useEffect, useState } from "react";
import { api, HistoryEntry } from "../lib/tauri";
import { errorMessage } from "../lib/errors";

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

export function HistoryView() {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <section>
      <header className="view-header">
        <div className="view-title-row">
          <h1>History</h1>
        </div>
        <p className="view-sub">
          {entries.length > 0 ? `${entries.length} recent changes` : "Recent task, tag, and template changes"}
        </p>
      </header>

      {loading && <p className="view-empty">Loading history...</p>}
      {error && <p className="composer-error" role="alert">Failed to load history: {error}</p>}
      {!loading && !error && entries.length === 0 && (
        <p className="view-empty">No history recorded yet.</p>
      )}
      {!loading && !error && entries.length > 0 && (
        <ol className="history-list">
          {entries.map((entry, index) => (
            <li className="history-row" key={`${entry.timestamp}-${entry.event}-${entry.entity_id}-${index}`}>
              <div className="history-main">
                <span className="history-summary">{entry.summary}</span>
                <span className="history-title">{entityLabel(entry)}</span>
              </div>
              <time className="history-time" dateTime={entry.timestamp}>{formatTime(entry.timestamp)}</time>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
