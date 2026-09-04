import { useMemo, useRef, useState, type DragEvent } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { api, DashboardView as DashboardViewKind, Document, Tag } from "../lib/tauri";
import { Indexes } from "../state/indexes";
import { dashboardHeatmapDays, dayStartHour, firstDayOfWeek } from "../lib/settings";
import { Heatmap, HeatCell, recurrenceStreak } from "../lib/recurrence-heatmap";
import { computeTagAnalytics, recurringScheduledDates } from "../lib/tag-analytics";
import { formatDate } from "../lib/dates";
import { currentLocale } from "../i18n";
import { HeatmapGrid } from "../components/HeatmapGrid";
import { dashboardOrderUpdates, sortDashboardPinnedTags } from "../lib/dashboard-tags";

type Props = { doc: Document; indexes: Indexes };

const DASHBOARD_VIEWS: DashboardViewKind[] = ["heatmap", "streak"];

export function DashboardView({ doc, indexes }: Props) {
  const { t } = useTranslation();
  const days = dashboardHeatmapDays(doc.settings);
  const fdow = firstDayOfWeek(doc.settings);
  const dsh = dayStartHour(doc.settings);
  const todayIso = indexes.todayIso;

  // Any tag can be pinned to the Dashboard (#dashboard) — it need not be a
  // recurrence tag. The pin lives on the tag (`dashboard_view`), and the card
  // shows the tag's activity heatmap aggregated across every task carrying it.
  const tags = useMemo(
    () => [...doc.tags].sort((a, b) => a.name.localeCompare(b.name)),
    [doc.tags],
  );
  const added = useMemo(
    () => sortDashboardPinnedTags(tags.filter(tag => tag.dashboard_view)),
    [tags],
  );
  const available = tags.filter(tag => !tag.dashboard_view);
  const draggingIdRef = useRef<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

  const setDragging = (id: string) => {
    draggingIdRef.current = id;
    setDraggingId(id);
  };

  const setTagView = (tag: Tag, view: DashboardViewKind | null) =>
    void api.updateTag({ id: tag.id, dashboard_view: view });

  const persistOrder = (ordered: Tag[]) => {
    for (const update of dashboardOrderUpdates(ordered)) {
      void api.updateTag(update);
    }
  };

  const reorder = (fromId: string, toId: string) => {
    if (fromId === toId) return;
    const fromIndex = added.findIndex(tag => tag.id === fromId);
    const toIndex = added.findIndex(tag => tag.id === toId);
    if (fromIndex < 0 || toIndex < 0) return;
    const next = [...added];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    persistOrder(next);
  };

  const moveBy = (id: string, delta: -1 | 1) => {
    const index = added.findIndex(tag => tag.id === id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= added.length) return;
    const next = [...added];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    persistOrder(next);
  };

  const clearDragState = () => {
    draggingIdRef.current = null;
    setDraggingId(null);
    setDropTargetId(null);
  };

  const handleDrop = (toId: string, e: DragEvent) => {
    const fromId = e.dataTransfer.getData("text/plain")
      || draggingIdRef.current
      || draggingId;
    if (fromId) reorder(fromId, toId);
    clearDragState();
  };

  const handleDragLeave = (e: DragEvent) => {
    const related = e.relatedTarget as Node | null;
    // Browsers often report relatedTarget === null while still over children;
    // only clear the drop highlight when the pointer truly left the list.
    if (related != null && !e.currentTarget.contains(related)) {
      setDropTargetId(null);
    }
  };

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
          <div className="dashboard-cards" onDragLeave={handleDragLeave}>
            {added.map((tag, index) => (
              <DashboardCard
                key={tag.id}
                tag={tag}
                indexes={indexes}
                tasks={doc.tasks}
                todayIso={todayIso}
                days={days}
                dayStartHour={dsh}
                firstDayOfWeek={fdow}
                isDragging={draggingId === tag.id}
                isDropTarget={dropTargetId === tag.id && draggingId !== tag.id}
                canMoveUp={index > 0}
                canMoveDown={index < added.length - 1}
                onSetView={view => setTagView(tag, view)}
                onRemove={() => setTagView(tag, null)}
                onMoveUp={() => moveBy(tag.id, -1)}
                onMoveDown={() => moveBy(tag.id, 1)}
                onDragStart={() => setDragging(tag.id)}
                onDragOver={() => setDropTargetId(tag.id)}
                onDrop={e => handleDrop(tag.id, e)}
                onDragEnd={clearDragState}
              />
            ))}
          </div>
          <Legend />
        </>
      )}
    </section>
  );
}

/** One pinned tag, rendered in its chosen view with view + remove controls. */
function DashboardCard({ tag, indexes, tasks, todayIso, days, dayStartHour: dsh, firstDayOfWeek, isDragging, isDropTarget, canMoveUp, canMoveDown, onSetView, onRemove, onMoveUp, onMoveDown, onDragStart, onDragOver, onDrop, onDragEnd }: {
  tag: Tag;
  indexes: Indexes;
  tasks: Document["tasks"];
  todayIso: string;
  days: number;
  dayStartHour: number;
  firstDayOfWeek: number;
  isDragging: boolean;
  isDropTarget: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onSetView: (view: DashboardViewKind) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDragStart: () => void;
  onDragOver: () => void;
  onDrop: (e: DragEvent) => void;
  onDragEnd: () => void;
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
      className={[
        "dashboard-card",
        isDragging ? "dashboard-card-dragging" : "",
        isDropTarget ? "dashboard-card-drop-target" : "",
      ].filter(Boolean).join(" ")}
      onDragOver={e => {
        e.preventDefault();
        onDragOver();
      }}
      onDrop={e => {
        e.preventDefault();
        onDrop(e);
      }}
    >
      <div className="dashboard-card-head">
        <div className="dashboard-card-title">
          <button
            type="button"
            className="dashboard-card-handle"
            draggable
            aria-label={t("dashboard.reorderHandle", { name: tag.name })}
            title={t("dashboard.reorderHandle", { name: tag.name })}
            onDragStart={e => {
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", tag.id);
              onDragStart();
            }}
            onDragEnd={onDragEnd}
          >
            <span aria-hidden>⋮⋮</span>
          </button>
          <span className="dashboard-card-name">
            <span style={{ color: tag.color }}>#</span>{tag.name}
          </span>
        </div>
        <div className="dashboard-card-controls">
          <div className="dashboard-card-reorder" role="group" aria-label={t("dashboard.reorderLabel")}>
            <button type="button" className="dashboard-reorder-btn"
                    aria-label={t("dashboard.moveUp", { name: tag.name })}
                    title={t("dashboard.moveUp", { name: tag.name })}
                    disabled={!canMoveUp}
                    onClick={onMoveUp}>↑</button>
            <button type="button" className="dashboard-reorder-btn"
                    aria-label={t("dashboard.moveDown", { name: tag.name })}
                    title={t("dashboard.moveDown", { name: tag.name })}
                    disabled={!canMoveDown}
                    onClick={onMoveDown}>↓</button>
          </div>
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
