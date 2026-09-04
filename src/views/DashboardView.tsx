import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { api, DashboardView as DashboardViewKind, Document, Tag } from "../lib/tauri";
import { errorMessage } from "../lib/errors";
import { Indexes } from "../state/indexes";
import { dashboardHeatmapDays, dayStartHour, firstDayOfWeek } from "../lib/settings";
import { Heatmap, HeatCell, recurrenceStreak } from "../lib/recurrence-heatmap";
import { computeTagAnalytics, recurringScheduledDates } from "../lib/tag-analytics";
import { formatDate } from "../lib/dates";
import { currentLocale } from "../i18n";
import { HeatmapGrid } from "../components/HeatmapGrid";
import { dashboardOrderUpdates, sortDashboardPinnedTags } from "../lib/dashboard-tags";
import { dashboardInsertIndexAtY, dashboardReorderAtIndex } from "../lib/dashboard-reorder";

type Props = { doc: Document; indexes: Indexes };

const DASHBOARD_VIEWS: DashboardViewKind[] = ["heatmap", "streak"];

export function DashboardView({ doc, indexes }: Props) {
  const { t } = useTranslation();
  const days = dashboardHeatmapDays(doc.settings);
  const fdow = firstDayOfWeek(doc.settings);
  const dsh = dayStartHour(doc.settings);
  const todayIso = indexes.todayIso;

  const tags = useMemo(
    () => [...doc.tags].sort((a, b) => a.name.localeCompare(b.name)),
    [doc.tags],
  );
  const available = tags.filter(tag => !tag.dashboard_view);
  const listRef = useRef<HTMLDivElement>(null);
  const draggingIdRef = useRef<string | null>(null);
  const insertIndexRef = useRef<number | null>(null);
  const captureTargetRef = useRef<HTMLElement | null>(null);
  const addedRef = useRef<Tag[]>([]);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [insertIndex, setInsertIndex] = useState<number | null>(null);
  const [orderedPinned, setOrderedPinned] = useState<Tag[] | null>(null);
  const [reorderError, setReorderError] = useState<string | null>(null);

  const added = useMemo(() => {
    if (orderedPinned) return orderedPinned;
    return sortDashboardPinnedTags(tags.filter(tag => tag.dashboard_view));
  }, [tags, orderedPinned]);
  addedRef.current = added;

  useEffect(() => {
    if (!orderedPinned) return;
    const fromDoc = sortDashboardPinnedTags(tags.filter(tag => tag.dashboard_view));
    const expected = dashboardOrderUpdates(orderedPinned);
    const actual = dashboardOrderUpdates(fromDoc);
    const synced = expected.length === actual.length
      && expected.every((update, index) =>
        actual[index]?.id === update.id
        && actual[index]?.dashboard_order === update.dashboard_order);
    if (synced) setOrderedPinned(null);
  }, [tags, orderedPinned]);

  const setTagView = (tag: Tag, view: DashboardViewKind | null) =>
    void api.updateTag({ id: tag.id, dashboard_view: view });

  const persistOrder = async (ordered: Tag[]) => {
    setOrderedPinned(ordered);
    setReorderError(null);
    try {
      for (const update of dashboardOrderUpdates(ordered)) {
        await api.updateTag(update);
      }
    } catch (err) {
      setOrderedPinned(null);
      setReorderError(errorMessage(err));
    }
  };

  const clearDragState = () => {
    draggingIdRef.current = null;
    insertIndexRef.current = null;
    setDraggingId(null);
    setInsertIndex(null);
  };

  const readInsertIndexAt = useCallback((clientY: number) => {
    const slots = listRef.current?.querySelectorAll<HTMLElement>('[data-dashboard-slot="card"]');
    if (!slots?.length) return 0;
    const rows = [...slots].map(slot => {
      const rect = slot.getBoundingClientRect();
      const height = rect.height || slot.clientHeight || 48;
      return { top: rect.top, height };
    });
    return dashboardInsertIndexAtY(rows, clientY);
  }, []);

  const updateInsertIndex = useCallback((clientY: number) => {
    const idx = readInsertIndexAt(clientY);
    insertIndexRef.current = idx;
    setInsertIndex(idx);
  }, [readInsertIndexAt]);

  const updateInsertIndexRef = useRef(updateInsertIndex);
  updateInsertIndexRef.current = updateInsertIndex;

  const commitReorder = useCallback(async () => {
    const fromId = draggingIdRef.current;
    const idx = insertIndexRef.current;
    clearDragState();
    if (!fromId || idx == null) return;
    const next = dashboardReorderAtIndex(addedRef.current, fromId, idx);
    if (!next) return;
    await persistOrder(next);
  }, []);

  const commitReorderRef = useRef(commitReorder);
  commitReorderRef.current = commitReorder;

  const releaseCapture = useCallback((e: globalThis.PointerEvent) => {
    const captureTarget = captureTargetRef.current;
    if (captureTarget?.hasPointerCapture(e.pointerId)) {
      captureTarget.releasePointerCapture(e.pointerId);
    }
    captureTargetRef.current = null;
  }, []);

  const releaseCaptureRef = useRef(releaseCapture);
  releaseCaptureRef.current = releaseCapture;

  const detachPointerListenersRef = useRef<(() => void) | null>(null);

  useEffect(() => () => {
    detachPointerListenersRef.current?.();
    detachPointerListenersRef.current = null;
  }, []);

  const onHandlePointerDown = (tagId: string) => (e: ReactPointerEvent<HTMLButtonElement>) => {
    if ((e.button ?? 0) !== 0) return;
    e.preventDefault();
    detachPointerListenersRef.current?.();
    captureTargetRef.current = e.currentTarget;
    if (e.currentTarget.setPointerCapture) {
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* unsupported */ }
    }
    const fromIndex = addedRef.current.findIndex(tag => tag.id === tagId);
    draggingIdRef.current = tagId;
    insertIndexRef.current = fromIndex;
    setDraggingId(tagId);
    setInsertIndex(fromIndex);

    const onPointerMove = (ev: globalThis.PointerEvent) => {
      ev.preventDefault();
      updateInsertIndexRef.current(ev.clientY);
    };
    const onPointerEnd = (ev: globalThis.PointerEvent) => {
      detachPointerListenersRef.current = null;
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerEnd);
      window.removeEventListener("pointercancel", onPointerEnd);
      if (draggingIdRef.current == null) return;
      releaseCaptureRef.current(ev);
      void commitReorderRef.current();
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerEnd);
    window.addEventListener("pointercancel", onPointerEnd);
    detachPointerListenersRef.current = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerEnd);
      window.removeEventListener("pointercancel", onPointerEnd);
    };
  };

  const dragging = draggingId != null;

  return (
    <section>
      <header className="view-header dashboard-header">
        <div className="dashboard-header-text">
          <h1>{t("nav.dashboard")}</h1>
          <p className="view-sub">{t("dashboard.subtitle")}</p>
        </div>
        {available.length > 0 && (
          <label className="dashboard-add">
            <select aria-label={t("dashboard.addTag")} value=""
                    onChange={e => {
                      const tag = available.find(x => x.id === e.currentTarget.value);
                      if (tag) setTagView(tag, "heatmap");
                    }}>
              <option value="" disabled>{t("dashboard.addTag")}</option>
              {available.map(tag => <option key={tag.id} value={tag.id}>#{tag.name}</option>)}
            </select>
          </label>
        )}
      </header>

      {tags.length === 0 ? (
        <p className="view-empty">{t("dashboard.empty")}</p>
      ) : added.length === 0 ? (
        <p className="view-empty">{t("dashboard.noPins")}</p>
      ) : (
        <>
          {reorderError && <p className="composer-error" role="alert">{reorderError}</p>}
          <div
            ref={listRef}
            className={["dashboard-cards", dragging ? "dashboard-cards-dragging" : ""].filter(Boolean).join(" ")}
          >
            {added.map((tag, index) => (
              <Fragment key={tag.id}>
                {dragging && insertIndex === index && (
                  <div className="dashboard-card-placeholder" aria-hidden />
                )}
                <div data-dashboard-slot="card">
                  <DashboardCard
                    tag={tag}
                    indexes={indexes}
                    tasks={doc.tasks}
                    todayIso={todayIso}
                    days={days}
                    dayStartHour={dsh}
                    firstDayOfWeek={fdow}
                    isDragging={draggingId === tag.id}
                    onSetView={view => setTagView(tag, view)}
                    onRemove={() => setTagView(tag, null)}
                    onHandlePointerDown={onHandlePointerDown(tag.id)}
                  />
                </div>
              </Fragment>
            ))}
            {dragging && insertIndex === added.length && (
              <div className="dashboard-card-placeholder" aria-hidden />
            )}
          </div>
          <Legend />
        </>
      )}
    </section>
  );
}

function DashboardCard({ tag, indexes, tasks, todayIso, days, dayStartHour: dsh, firstDayOfWeek, isDragging, onSetView, onRemove, onHandlePointerDown }: {
  tag: Tag;
  indexes: Indexes;
  tasks: Document["tasks"];
  todayIso: string;
  days: number;
  dayStartHour: number;
  firstDayOfWeek: number;
  isDragging: boolean;
  onSetView: (view: DashboardViewKind) => void;
  onRemove: () => void;
  onHandlePointerDown: (e: ReactPointerEvent<HTMLButtonElement>) => void;
}) {
  const { t } = useTranslation();
  const view = tag.dashboard_view ?? "heatmap";
  const heat = useMemo(() => {
    const taggedTasks = tasks.filter(task => task.tag_ids.includes(tag.id));
    return computeTagAnalytics(
      taggedTasks,
      todayIso,
      days,
      recurringScheduledDates(indexes, tag.id, days),
      dsh,
    ).heat;
  }, [tag.id, tasks, todayIso, days, indexes, dsh]);

  return (
    <div
      className={["dashboard-card", isDragging ? "dashboard-card-dragging" : ""].filter(Boolean).join(" ")}
    >
      <div className="dashboard-card-head">
        <div className="dashboard-card-title">
          <button
            type="button"
            className="dashboard-card-handle"
            aria-label={t("dashboard.reorderHandle", { name: tag.name })}
            title={t("dashboard.reorderHandle", { name: tag.name })}
            onPointerDown={onHandlePointerDown}
          >
            <span className="dashboard-handle-dots" aria-hidden>
              {Array.from({ length: 6 }, (_, i) => <span key={i} />)}
            </span>
          </button>
          <span className="dashboard-card-name">
            <span style={{ color: tag.color }}>#</span>{tag.name}
          </span>
        </div>
        <div className="dashboard-card-controls">
          <div className="te-segmented" role="group" aria-label={t("dashboard.viewLabel")}>
            {DASHBOARD_VIEWS.map(v => (
              <button key={v} type="button" aria-pressed={view === v}
                      className={view === v ? "active" : ""}
                      onClick={() => onSetView(v)}>
                {t(`dashboard.view_${v}`)}
              </button>
            ))}
          </div>
          <button type="button" className="dashboard-remove"
                  aria-label={t("dashboard.remove")} title={t("dashboard.remove")}
                  onClick={onRemove}>✕</button>
        </div>
      </div>
      {view === "heatmap"
        ? <HeatmapBody heat={heat} days={days} todayIso={todayIso} firstDayOfWeek={firstDayOfWeek} />
        : <StreakBody heat={heat} todayIso={todayIso} />}
    </div>
  );
}

/** Heatmap view body: summary stats + the rolling grid. */
function HeatmapBody({ heat, days, todayIso, firstDayOfWeek }: {
  heat: Heatmap; days: number; todayIso: string; firstDayOfWeek: number;
}) {
  const { t } = useTranslation();
  const completion = heat.scheduled > 0 ? Math.round((heat.done / heat.scheduled) * 100) : 0;
  return (
    <>
      <div className="heatmap-stats" role="status">
        <Stat num={heat.done} label={t("dashboard.done")} />
        <Stat num={heat.skipped} label={t("dashboard.skipped")} />
        <Stat num={`${completion}%`} label={t("dashboard.completion")} />
        <Stat num={days} label={t("dashboard.rangeLabel")} />
      </div>
      <HeatmapGrid
        cells={heat.cells}
        todayIso={todayIso}
        firstDayOfWeek={firstDayOfWeek}
        ariaLabel={t("dashboard.heatmapAria")}
        labelForCell={cell => cellTip(t, cell)}
      />
    </>
  );
}

/** Streak view body: the last 7 days as cells + the current done streak. */
function StreakBody({ heat, todayIso }: { heat: Heatmap; todayIso: string }) {
  const { t } = useTranslation();
  const last7 = heat.cells.slice(-7);
  const streak = recurrenceStreak(heat.cells);
  return (
    <div className="dashboard-streak">
      <div className="dashboard-streak-strip" aria-label={t("dashboard.last7")}>
        {last7.map((cell, i) => {
          const cls = `heatmap-cell heatmap-${cell.status}${cell.iso === todayIso ? " heatmap-today" : ""}`;
          const label = cellTip(t, cell);
          return <span key={i} className={cls} title={label} aria-label={label} />;
        })}
      </div>
      <div className="dashboard-streak-count">
        <span className="dashboard-streak-num">{streak}</span>
        <span className="dashboard-streak-flame" aria-hidden>🔥</span>
        <span className="dashboard-streak-label">{t("dashboard.streakLabel")}</span>
      </div>
    </div>
  );
}

function Stat({ num, label }: { num: number | string; label: string }) {
  return (
    <span className="heatmap-stat">
      <span className="heatmap-stat-num">{num}</span>
      <span className="heatmap-stat-label">{label}</span>
    </span>
  );
}

function Legend() {
  const { t } = useTranslation();
  return (
    <ul className="heatmap-legend" aria-label={t("dashboard.legendAria")}>
      <li><span className="heatmap-cell heatmap-done" /> {t("dashboard.legendDone")}</li>
      <li><span className="heatmap-cell heatmap-skip" /> {t("dashboard.legendSkip")}</li>
      <li><span className="heatmap-cell heatmap-none" /> {t("dashboard.legendNone")}</li>
    </ul>
  );
}

/** Tooltip/aria label for a heatmap cell (date + status), shared by both views. */
function cellTip(t: TFunction, cell: HeatCell): string {
  const d = new Date(`${cell.iso}T00:00:00Z`);
  const date = formatDate(d, "slash_ymd", currentLocale());
  return t(`dashboard.tip${cap(cell.status)}`, { date });
}

function cap(s: string): string {
  return s[0].toUpperCase() + s.slice(1);
}
