import { useEffect, useState } from "react";
import { api, Task } from "../lib/tauri";
import { TaskList } from "../components/TaskList";
import { Indexes } from "../state/indexes";
import { todayIso } from "../lib/dates";

type Props = { indexes: Indexes };

export function SearchView({ indexes }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Task[]>([]);

  useEffect(() => {
    let cancelled = false;
    const q = query.trim();
    if (!q) { setResults([]); return; }
    const handle = setTimeout(() => {
      api.searchTasks(q).then(r => { if (!cancelled) setResults(r); }).catch(() => {});
    }, 120);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [query]);

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
      {query && (
        <p className="search-meta">
          {results.length} result{results.length === 1 ? "" : "s"}
        </p>
      )}
      <TaskList tasks={results} tags={indexes.tagsById} todayIso={todayIso()}
                emptyText={query ? "No matches." : "Type a query to search."} />
    </section>
  );
}
