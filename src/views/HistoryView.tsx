import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { api, HistoryEntry } from "../lib/tauri";
import { errorMessage } from "../lib/errors";
import { currentLocale } from "../i18n";

const PAGE_SIZES = [10, 30, 50] as const;

function formatTime(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString(currentLocale(), {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function entityLabel(entry: HistoryEntry, t: TFunction): string {
  if (entry.entity === "tag") return entry.title;
  if (entry.entity === "template") return t("history.templatePrefix", { title: entry.title });
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
  const { t } = useTranslation();
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
          <h1>{t("nav.history")}</h1>
        </div>
        <p className="view-sub">
          {entries.length > 0
            ? filtering
              ? t("history.subtitleFiltered", { shown: filtered.length, total: entries.length })
              : t("history.subtitleAll", { total: entries.length })
            : t("history.subtitleEmpty")}
        </p>
      </header>

      <input
        className="search-input"
        value={query}
        onChange={e => onQuery(e.currentTarget.value)}
        placeholder={t("history.searchPlaceholder")}
        aria-label={t("history.searchAria")}
      />

      <div className="archived-filters">
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
        <p className="composer-error" role="alert">{t("history.invalidRange")}</p>
      )}

      {loading && <p className="view-empty">{t("history.loading")}</p>}
      {error && <p className="composer-error" role="alert">{t("history.loadError", { error })}</p>}
      {!loading && !error && entries.length === 0 && (
        <p className="view-empty">{t("history.emptyNone")}</p>
      )}
      {!loading && !error && entries.length > 0 && (
        <>
          {pageItems.length === 0 ? (
            <p className="view-empty">{t("history.emptyFiltered")}</p>
          ) : (
            <ol className="history-list">
              {pageItems.map((entry, index) => (
                <li className="history-row" key={`${entry.timestamp}-${entry.event}-${entry.entity_id}-${start + index}`}>
                  <div className="history-main">
                    <span className="history-summary">{entry.summary}</span>
                    <span className="history-title">{entityLabel(entry, t)}</span>
                  </div>
                  <time className="history-time" dateTime={entry.timestamp}>{formatTime(entry.timestamp)}</time>
                </li>
              ))}
            </ol>
          )}

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
            <select aria-label={t("history.perPageAria")} value={pageSize}
                    onChange={e => onPageSize(Number(e.currentTarget.value))}>
              {PAGE_SIZES.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        </>
      )}
    </section>
  );
}
