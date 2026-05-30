import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api, Task } from "../lib/tauri";
import { errorMessage } from "../lib/errors";
import { TaskList } from "../components/TaskList";
import { Indexes } from "../state/indexes";
import { todayIso } from "../lib/dates";

type Props = { indexes: Indexes };

export function SearchView({ indexes }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Task[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Bumped on every store-changed so the current query re-runs against fresh data.
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const unlisten = listen("store-changed", () => setReloadKey(k => k + 1));
    return () => { void unlisten.then(f => f()); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const q = query.trim();
    if (!q) { setResults([]); setError(null); return; }
    const handle = setTimeout(() => {
      api.searchTasks(q)
        .then(r => { if (!cancelled) { setResults(r); setError(null); } })
        .catch(e => { if (!cancelled) { setError(errorMessage(e)); } });
    }, 120);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [query, reloadKey]);

  return (
    <section>
      <header className="view-header">
        <h1>Search</h1>
        <p className="view-sub">Substring match across title and notes</p>
      </header>
      <input
        className="search-input"
        autoFocus
        value={query}
        onChange={e => setQuery(e.currentTarget.value)}
        placeholder="Type to search…"
        aria-label="Search query"
      />
      {query && error ? (
        <p className="composer-error" role="alert">Search failed: {error}</p>
      ) : (
        <>
          {query && (
            <p className="search-meta">
              {results.length} result{results.length === 1 ? "" : "s"}
            </p>
          )}
          <TaskList tasks={results} tags={indexes.tagsById} todayIso={todayIso()}
                    emptyText={query ? "No matches." : "Type a query to search."} />
        </>
      )}
    </section>
  );
}
