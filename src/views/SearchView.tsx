import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { PageSizeSelect, PaginationControls } from "../components/ListControls";
import { TaskList } from "../components/TaskList";
import { usePagedItems } from "../lib/listPaging";
import { taskMatchesQuery } from "../lib/taskSearch";
import { Document, SortOrder } from "../lib/tauri";
import { Indexes, sortTasks } from "../state/indexes";
import { useHeldCompletions, withHeld } from "../state/heldCompletions";

type Props = { doc: Document; indexes: Indexes };

export function SearchView({ doc, indexes }: Props) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const { held, onCompleted, onReopened } = useHeldCompletions(doc.tasks);

  const trimmed = query.trim();
  const filtering = trimmed !== "";
  const order: SortOrder = doc.settings.sort_order === "date" ? "date" : "priority";

  const matched = useMemo(() => {
    if (!filtering) return [];
    const hits = indexes.tasks.filter(task =>
      taskMatchesQuery(task, trimmed, indexes.tagsById),
    );
    return sortTasks([...hits], order, indexes.tagsById);
  }, [indexes.tasks, indexes.tagsById, filtering, trimmed, order]);

  const tasks = withHeld(matched, held);

  const {
    pageSize,
    setPageSize,
    page: current,
    setPage,
    totalPages,
    pageItems,
    resetPage,
  } = usePagedItems(tasks);

  const onQuery = (v: string) => { setQuery(v); resetPage(); };

  return (
    <section>
      <header className="view-header">
        <div className="view-title-row">
          <h1>{t("nav.search")}</h1>
        </div>
        <p className="view-sub">
          {filtering
            ? t("search.subtitleFiltered", { shown: matched.length, total: indexes.tasks.length })
            : t("search.subtitlePrompt", { total: indexes.tasks.length })}
        </p>
      </header>

      <input
        className="search-input"
        value={query}
        onChange={e => onQuery(e.currentTarget.value)}
        placeholder={t("search.searchPlaceholder")}
        aria-label={t("search.searchAria")}
      />

      <TaskList
        tasks={pageItems}
        tags={indexes.tagsById}
        todayIso={indexes.todayIso}
        emptyText={filtering ? t("search.emptyFiltered") : t("search.emptyPrompt")}
        onCompleted={onCompleted}
        onReopened={onReopened}
      />

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
        ariaLabel={t("search.perPageAria")}
        value={pageSize}
        onChange={setPageSize}
      />
    </section>
  );
}
