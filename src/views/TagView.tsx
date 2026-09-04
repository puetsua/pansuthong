import { useMemo, useState } from "react";
import { useParams, Navigate, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { AssignIdle } from "../components/AssignIdle";
import { Composer } from "../components/Composer";
import { HeatmapGrid } from "../components/HeatmapGrid";
import { IdleStatus } from "../components/IdleStatus";
import { RowList } from "../components/RowList";
import { TagEditor } from "../components/TagEditor";
import { Indexes } from "../state/indexes";
import { useHeldCompletions, withHeld } from "../state/heldCompletions";
import { Document, isDone } from "../lib/tauri";
import { formatDate } from "../lib/dates";
import { currentLocale } from "../i18n";
import { dayStartHour, firstDayOfWeek, dashboardHeatmapDays } from "../lib/settings";
import { formatDurationShort } from "../lib/time";
import { useIdleAnchor } from "../lib/useIdleAnchor";
import { recurrenceStreak, type HeatCell, type Heatmap } from "../lib/recurrence-heatmap";
import { computeTagAnalytics, recurringScheduledDates } from "../lib/tag-analytics";

type Props = { doc: Document; indexes: Indexes };
type Tab = "tasks" | "analytics";

export function TagView({ doc, indexes }: Props) {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useState<Tab>("tasks");
  const [assigning, setAssigning] = useState(false);
  const { idleAnchorMs, resetIdleAnchor } = useIdleAnchor();
  // Hold just-completed tasks visible until this view is left/refreshed (#recover).
  const { held, onCompleted, onReopened } = useHeldCompletions(doc.tasks);
  const tagId = id ?? "";
  const taggedTasks = useMemo(
    () => doc.tasks.filter(task => task.tag_ids.includes(tagId)),
    [doc.tasks, tagId],
  );
  const analytics = useMemo(
    () => {
      const days = dashboardHeatmapDays(doc.settings);
      return computeTagAnalytics(
        taggedTasks,
        indexes.todayIso,
        days,
        recurringScheduledDates(indexes, tagId, days),
        dayStartHour(doc.settings),
      );
    },
    [taggedTasks, indexes, indexes.todayIso, doc.settings, tagId],
  );
  const fdow = firstDayOfWeek(doc.settings);

  if (!id) return <Navigate to="/today" replace />;

  const tag = indexes.tagsById.get(id);
  if (!tag) return <p className="view-empty">{t("tagView.notFound")}</p>;

  const active = indexes.byTag.get(id) ?? [];
  const tasks = withHeld(active, held);
  const candidates = active.filter(task => !isDone(task));
  const ghosts = indexes.ghostsForDate(indexes.todayIso).filter(g => g.tag_ids.includes(id));
  const rows = indexes.mergeRows(tasks, ghosts);
  const open  = active.filter(t => !isDone(t)).length;

  return (
    <section>
      <header className="view-header">
        <div className="view-title-row">
          <h1><span style={{ color: tag.color }}>#</span>{tag.name}</h1>
          <button type="button" className="link-button tag-edit-link"
                  onClick={() => setEditing(true)}>{t("tagView.editTag")}</button>
        </div>
        <p className="view-sub">
          {t("tagView.subtitle", { open, total: tasks.length })}
          <IdleStatus tasks={doc.tasks} active={assigning} idleAnchorMs={idleAnchorMs}
                      onResetIdle={resetIdleAnchor}
                      onAssign={tab === "tasks" && candidates.length > 0 ? () => setAssigning(a => !a) : undefined} />
        </p>
      </header>
      <div className="tag-view-tabs te-segmented" role="tablist" aria-label={t("tagView.tabsAria")}>
        <button type="button" role="tab" aria-selected={tab === "tasks"}
                className={tab === "tasks" ? "active" : ""}
                onClick={() => setTab("tasks")}>
          {t("tagView.tabTasks")}
        </button>
        <button type="button" role="tab" aria-selected={tab === "analytics"}
                className={tab === "analytics" ? "active" : ""}
                onClick={() => setTab("analytics")}>
          {t("tagView.tabAnalytics")}
        </button>
      </div>
      {tab === "tasks" ? (
        <>
          {assigning ? (
            <AssignIdle tasks={doc.tasks} candidates={candidates} idleAnchorMs={idleAnchorMs}
                        onClose={() => setAssigning(false)} />
          ) : (
            <Composer todayIso={indexes.todayIso} tagsByName={indexes.tagsByName} allTags={indexes.tagsById} contextTagId={id} />
          )}
          <RowList rows={rows} tags={indexes.tagsById} todayIso={indexes.todayIso}
                   emptyText={t("tagView.empty")}
                   onCompleted={onCompleted} onReopened={onReopened}
                   onTimerStarted={() => setAssigning(false)} />
        </>
      ) : (
        <TagAnalytics
          heat={analytics.heat}
          totalSpentMs={analytics.totalSpentMs}
          scheduledDays={analytics.scheduledDays}
          completedTasks={analytics.completedTasks}
          openTasks={analytics.openTasks}
          todayIso={indexes.todayIso}
          firstDayOfWeek={fdow}
        />
      )}
      {editing && (
        <TagEditor
          tag={tag}
          onClose={() => setEditing(false)}
          onDeleted={() => navigate("/today")}
        />
      )}
    </section>
  );
}

function TagAnalytics({ heat, totalSpentMs, scheduledDays, completedTasks, openTasks, todayIso, firstDayOfWeek }: {
  heat: Heatmap;
  totalSpentMs: number;
  scheduledDays: number;
  completedTasks: number;
  openTasks: number;
  todayIso: string;
  firstDayOfWeek: number;
}) {
  const { t } = useTranslation();
  return (
    <div className="tag-analytics">
      <div className="heatmap-stats" role="status">
        <Stat num={formatDurationShort(totalSpentMs)} label={t("tagView.totalSpent")} />
        <Stat num={scheduledDays} label={t("tagView.scheduledDays")} />
        <Stat num={recurrenceStreak(heat.cells)} label={t("tagView.streakLabel")} />
        <Stat num={completedTasks} label={t("tagView.completedTasks")} />
        <Stat num={openTasks} label={t("tagView.openTasks")} />
      </div>
      <HeatmapGrid
        cells={heat.cells}
        todayIso={todayIso}
        firstDayOfWeek={firstDayOfWeek}
        ariaLabel={t("tagView.heatmapAria")}
        labelForCell={cell => tagCellTip(t, cell)}
      />
      <ul className="heatmap-legend" aria-label={t("tagView.legendAria")}>
        <li><span className="heatmap-cell heatmap-done" /> {t("tagView.legendActivity")}</li>
        <li><span className="heatmap-cell heatmap-skip" /> {t("tagView.legendScheduled")}</li>
        <li><span className="heatmap-cell heatmap-none" /> {t("tagView.legendNone")}</li>
      </ul>
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

function tagCellTip(t: TFunction, cell: HeatCell): string {
  const d = new Date(`${cell.iso}T00:00:00Z`);
  const date = formatDate(d, "slash_ymd", currentLocale());
  return t(`tagView.tip${cap(cell.status)}`, { date });
}

function cap(s: string): string {
  return s[0].toUpperCase() + s.slice(1);
}
