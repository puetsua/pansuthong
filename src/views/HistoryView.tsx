import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { todayIso as computeTodayIso, formatDateTime, currentDateFormat, currentTimeFormat } from "../lib/dates";
import { api, HistoryEntry } from "../lib/tauri";
import { DateRangeFilters, PageSizeSelect, PaginationControls } from "../components/ListControls";
import { usePagedItems } from "../lib/listPaging";
import { errorMessage } from "../lib/errors";
import { currentLocale } from "../i18n";

type Props = {
  todayIso?: string;
};

function formatTime(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return formatDateTime(d, currentDateFormat(), currentTimeFormat(), currentLocale());
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

export function HistoryView({ todayIso = computeTodayIso() }: Props) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [from, setFrom] = useState(() => todayIso);
  const [to, setTo] = useState(() => todayIso);

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

  const {
    pageSize,
    setPageSize,
    page: current,
    setPage,
    totalPages,
    start,
    pageItems,
    resetPage,
  } = usePagedItems(filtered);

  const onQuery = (v: string) => { setQuery(v); resetPage(); };
  const onFrom = (v: string) => { setFrom(v); resetPage(); };
  const onTo = (v: string) => { setTo(v); resetPage(); };
  const clearDates = () => { setFrom(""); setTo(""); resetPage(); };

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
            ariaLabel={t("history.perPageAria")}
            value={pageSize}
            onChange={setPageSize}
          />
        </>
      )}
    </section>
  );
}
