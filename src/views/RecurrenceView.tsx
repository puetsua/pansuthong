import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { api, DashboardView, Document, TemplateTask } from "../lib/tauri";
import { Indexes } from "../state/indexes";
import { recurrenceHeatmapDays, firstDayOfWeek } from "../lib/settings";
import { computeHeatmap, Heatmap, HeatCell, HeatStatus, recurrenceStreak } from "../lib/recurrence-heatmap";
import { formatDate } from "../lib/dates";
import { currentLocale } from "../i18n";
import { HeatmapGrid } from "../components/HeatmapGrid";

type Props = { doc: Document; indexes: Indexes };

/** Only templates with a recurrence schedule and a recurrence tag are dashable. */
function isDashable(t: TemplateTask): boolean {
  return !!t.recurrence && !!t.recurrence_tag_id;
}

const DASHBOARD_VIEWS: DashboardView[] = ["heatmap", "streak"];

/** A dashboard unit: one recurrence tag plus the templates filed under it. The
 *  heatmap/streak aggregate every template sharing the tag (done/skip detection is
 *  tag-based), and `view` is `undefined` until the tag is added to the dashboard. */
type TagGroup = { tagId: string; name: string; templates: TemplateTask[]; view?: DashboardView };

export function RecurrenceView({ doc, indexes }: Props) {
  const { t } = useTranslation();
  const days = recurrenceHeatmapDays(doc.settings);
  const fdow = firstDayOfWeek(doc.settings);
  const todayIso = indexes.todayIso;

  const recurring = useMemo(
    () => doc.template_tasks.filter(isDashable),
    [doc.template_tasks],
  );

  // The dashboard is organized by recurrence tag, not by individual template:
  // several templates can share a tag and the heatmap keys off the tag alone.
  const groups = useMemo<TagGroup[]>(() => {
    const byTag = new Map<string, TagGroup>();
    for (const tmpl of recurring) {
      const tagId = tmpl.recurrence_tag_id!; // isDashable guarantees a tag
      let g = byTag.get(tagId);
      if (!g) {
        g = { tagId, name: indexes.tagsById.get(tagId)?.name ?? "?", templates: [] };
        byTag.set(tagId, g);
      }
      g.templates.push(tmpl);
      // A tag is "added" if any of its templates carries a view; first one wins.
      if (g.view === undefined && tmpl.dashboard_view) g.view = tmpl.dashboard_view;
    }
    return [...byTag.values()];
  }, [recurring, indexes.tagsById]);

  const added = groups.filter(g => g.view !== undefined);
  const available = groups.filter(g => g.view === undefined);

  // View/add/remove persist on every template under the tag (so the whole tag
  // group stays in sync); the store refresh re-renders from the new doc.
  const setTagView = (group: TagGroup, view: DashboardView | null) => {
    for (const tmpl of group.templates) void api.updateTemplate({ id: tmpl.id, dashboard_view: view });
  };

  return (
    <section>
      <header className="view-header dashboard-header">
        <div className="dashboard-header-text">
          <h1>{t("nav.recurrence")}</h1>
          <p className="view-sub">{t("recurrence.subtitle")}</p>
        </div>
        {available.length > 0 && (
          <label className="dashboard-add">
            <select aria-label={t("recurrence.addTag")} value=""
                    onChange={e => {
                      const g = available.find(x => x.tagId === e.currentTarget.value);
                      if (g) setTagView(g, "heatmap");
                    }}>
              <option value="" disabled>{t("recurrence.addTag")}</option>
              {available.map(g => <option key={g.tagId} value={g.tagId}>#{g.name}</option>)}
            </select>
          </label>
        )}
      </header>

      {recurring.length === 0 ? (
        <p className="view-empty">{t("recurrence.empty")}</p>
      ) : added.length === 0 ? (
        <p className="view-empty">{t("recurrence.noPins")}</p>
      ) : (
        <>
          <div className="dashboard-cards">
            {added.map(group => (
              <DashboardCard
                key={group.tagId}
                group={group}
                tasks={doc.tasks}
                todayIso={todayIso}
                days={days}
                firstDayOfWeek={fdow}
                onSetView={view => setTagView(group, view)}
                onRemove={() => setTagView(group, null)}
              />
            ))}
          </div>
          <Legend />
        </>
      )}
    </section>
  );
}

/** One added tag, rendered in its chosen view with view + remove controls. */
function DashboardCard({ group, tasks, todayIso, days, firstDayOfWeek, onSetView, onRemove }: {
  group: TagGroup;
  tasks: Document["tasks"];
  todayIso: string;
  days: number;
  firstDayOfWeek: number;
  onSetView: (view: DashboardView) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const view = group.view ?? "heatmap";
  const heat = useMemo(
    () => mergeHeatmaps(group.templates.map(template => computeHeatmap({ template, tasks, todayIso, days }))),
    [group.templates, tasks, todayIso, days],
  );

  return (
    <div className="dashboard-card">
      <div className="dashboard-card-head">
        <span className="dashboard-card-title">
          <span className="dashboard-card-name">#{group.name}</span>
        </span>
        <div className="dashboard-card-controls">
          <div className="te-segmented" role="group" aria-label={t("recurrence.viewLabel")}>
            {DASHBOARD_VIEWS.map(v => (
              <button key={v} type="button" aria-pressed={view === v}
                      className={view === v ? "active" : ""}
                      onClick={() => onSetView(v)}>
                {t(`recurrence.view_${v}`)}
              </button>
            ))}
          </div>
          <button type="button" className="dashboard-remove"
                  aria-label={t("recurrence.remove")} title={t("recurrence.remove")}
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
      <div className="recurrence-stats" role="status">
        <Stat num={heat.done} label={t("recurrence.done")} />
        <Stat num={heat.skipped} label={t("recurrence.skipped")} />
        <Stat num={`${completion}%`} label={t("recurrence.completion")} />
        <Stat num={days} label={t("recurrence.rangeLabel")} />
      </div>
      <HeatmapGrid
        cells={heat.cells}
        todayIso={todayIso}
        firstDayOfWeek={firstDayOfWeek}
        ariaLabel={t("recurrence.heatmapAria")}
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
      <div className="dashboard-streak-strip" aria-label={t("recurrence.last7")}>
        {last7.map((cell, i) => {
          const cls = `heatmap-cell heatmap-${cell.status}${cell.iso === todayIso ? " heatmap-today" : ""}`;
          const label = cellTip(t, cell);
          return <span key={i} className={cls} title={label} aria-label={label} />;
        })}
      </div>
      <div className="dashboard-streak-count">
        <span className="dashboard-streak-num">{streak}</span>
        <span className="dashboard-streak-flame" aria-hidden>🔥</span>
        <span className="dashboard-streak-label">{t("recurrence.streakLabel")}</span>
      </div>
    </div>
  );
}

function Stat({ num, label }: { num: number | string; label: string }) {
  return (
    <span className="recurrence-stat">
      <span className="recurrence-stat-num">{num}</span>
      <span className="recurrence-stat-label">{label}</span>
    </span>
  );
}

function Legend() {
  const { t } = useTranslation();
  return (
    <ul className="heatmap-legend" aria-label={t("recurrence.legendAria")}>
      <li><span className="heatmap-cell heatmap-done" /> {t("recurrence.legendDone")}</li>
      <li><span className="heatmap-cell heatmap-skip" /> {t("recurrence.legendSkip")}</li>
      <li><span className="heatmap-cell heatmap-none" /> {t("recurrence.legendNone")}</li>
    </ul>
  );
}

/** Tooltip/aria label for a heatmap cell (date + status), shared by both views. */
function cellTip(t: TFunction, cell: HeatCell): string {
  const d = new Date(`${cell.iso}T00:00:00Z`);
  const date = formatDate(d, "slash_ymd", currentLocale());
  return t(`recurrence.tip${cap(cell.status)}`, { date });
}

/** Combine per-template heatmaps under one tag into a single series. The maps are
 *  day-aligned, so a day is "done" if any template did it, "skip" if any scheduled
 *  it without a completion, else "none". Done/skip never conflict for a day since
 *  detection is tag-based (identical across the group). */
function mergeHeatmaps(maps: Heatmap[]): Heatmap {
  if (maps.length === 1) return maps[0];
  const base = maps[0];
  const cells = base.cells.map((c, i) => {
    let status: HeatStatus = "none";
    for (const m of maps) {
      const s = m.cells[i].status;
      if (s === "done") { status = "done"; break; }
      if (s === "skip") status = "skip";
    }
    return { iso: c.iso, status };
  });
  const scheduled = cells.filter(c => c.status !== "none").length;
  const done = cells.filter(c => c.status === "done").length;
  return { cells, scheduled, done, skipped: scheduled - done };
}

function cap(s: string): string {
  return s[0].toUpperCase() + s.slice(1);
}
