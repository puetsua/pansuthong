import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Document, TemplateTask } from "../lib/tauri";
import { Indexes } from "../state/indexes";
import { recurrenceHeatmapDays, firstDayOfWeek } from "../lib/settings";
import { computeHeatmap, HeatCell, Heatmap, HeatStatus } from "../lib/recurrence-heatmap";
import { formatDate } from "../lib/dates";
import { currentLocale } from "../i18n";

type Props = { doc: Document; indexes: Indexes };

/** Only templates with a recurrence schedule and a recurrence tag are dashable. */
function isDashable(t: TemplateTask): boolean {
  return !!t.recurrence && !!t.recurrence_tag_id;
}

// Indexed by JS `getDay` (0 = Sunday .. 6 = Saturday) so the heatmap can order
// rows from any configured first day of the week.
const WEEKDAY_KEYS = [
  "taskEditor.weekdaySun", "taskEditor.weekdayMon", "taskEditor.weekdayTue",
  "taskEditor.weekdayWed", "taskEditor.weekdayThu", "taskEditor.weekdayFri",
  "taskEditor.weekdaySat",
];

/** Position of a date within its week (0..6) given the configured first weekday
 *  (`fdow`, 0=Sun..6=Sat). Used both to front-pad the grid and to label rows. */
function weekPosition(iso: string, fdow: number): number {
  const [y, m, d] = iso.split("-").map(Number);
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun..6=Sat
  return (js - fdow + 7) % 7;
}

export function RecurrenceView({ doc, indexes }: Props) {
  const { t } = useTranslation();
  const days = recurrenceHeatmapDays(doc.settings);
  const fdow = firstDayOfWeek(doc.settings);
  const todayIso = indexes.todayIso;

  const recurring = useMemo(
    () => doc.template_tasks.filter(isDashable),
    [doc.template_tasks],
  );

  // Several templates can share one recurrence tag, and the heatmap's done/skip
  // detection is keyed by that tag alone — so they're really one tag-based series.
  // Group them so the picker shows a single "#tag" entry and the dashboard
  // aggregates every template under it.
  const groups = useMemo(() => {
    const byTag = new Map<string, TemplateTask[]>();
    for (const tmpl of recurring) {
      const key = tmpl.recurrence_tag_id!; // isDashable guarantees a tag
      const list = byTag.get(key);
      if (list) list.push(tmpl); else byTag.set(key, [tmpl]);
    }
    return [...byTag].map(([tagId, templates]) => ({ tagId, templates }));
  }, [recurring]);

  const [selectedTagId, setSelectedTagId] = useState<string>(() => groups[0]?.tagId ?? "");
  const group = groups.find(g => g.tagId === selectedTagId) ?? groups[0];

  const heat = useMemo(
    () => group
      ? mergeHeatmaps(group.templates.map(template => computeHeatmap({ template, tasks: doc.tasks, todayIso, days })))
      : null,
    [group, doc.tasks, todayIso, days],
  );

  const completion = heat && heat.scheduled > 0
    ? Math.round((heat.done / heat.scheduled) * 100)
    : 0;

  return (
    <section>
      <header className="view-header">
        <h1>{t("nav.recurrence")}</h1>
        <p className="view-sub">{t("recurrence.subtitle")}</p>
      </header>

      {recurring.length === 0 ? (
        <p className="view-empty">{t("recurrence.empty")}</p>
      ) : (
        <>
          <label className="te-field recurrence-picker">
            <span>{t("recurrence.pickTemplate")}</span>
            <select
              className="select-input"
              aria-label={t("recurrence.pickTemplate")}
              value={group?.tagId ?? ""}
              onChange={e => setSelectedTagId(e.currentTarget.value)}
            >
              {groups.map(g => {
                const tag = indexes.tagsById.get(g.tagId)?.name ?? "?";
                // Tooltip lists the task(s) merged under this tag so identical
                // "#tag" entries are still tellable apart on hover.
                const titles = g.templates.map(tmpl => tmpl.title).join(", ");
                return (
                  <option key={g.tagId} value={g.tagId} title={titles}>
                    #{tag}
                  </option>
                );
              })}
            </select>
          </label>

          {heat && group && (
            <>
              <div className="recurrence-stats" role="status">
                <span className="recurrence-stat">
                  <span className="recurrence-stat-num">{heat.done}</span>
                  <span className="recurrence-stat-label">{t("recurrence.done")}</span>
                </span>
                <span className="recurrence-stat">
                  <span className="recurrence-stat-num">{heat.skipped}</span>
                  <span className="recurrence-stat-label">{t("recurrence.skipped")}</span>
                </span>
                <span className="recurrence-stat">
                  <span className="recurrence-stat-num">{completion}%</span>
                  <span className="recurrence-stat-label">{t("recurrence.completion")}</span>
                </span>
                <span className="recurrence-stat">
                  <span className="recurrence-stat-num">{days}</span>
                  <span className="recurrence-stat-label">{t("recurrence.rangeLabel")}</span>
                </span>
              </div>

              <HeatmapGrid cells={heat.cells} todayIso={todayIso} firstDayOfWeek={fdow} />

              <ul className="heatmap-legend" aria-label={t("recurrence.legendAria")}>
                <li><span className="heatmap-cell heatmap-done" /> {t("recurrence.legendDone")}</li>
                <li><span className="heatmap-cell heatmap-skip" /> {t("recurrence.legendSkip")}</li>
                <li><span className="heatmap-cell heatmap-none" /> {t("recurrence.legendNone")}</li>
              </ul>
            </>
          )}
        </>
      )}
    </section>
  );
}

/** A GitHub-style rolling heatmap: one column per ISO week (Mon..Sun) showing
 *  the most recent `cells.length` days ending today. Month labels sit above the
 *  week columns and weekday labels sit to the left of each row. Built from the
 *  flat `cells` array so it stays in lock-step with `computeHeatmap`. */
function HeatmapGrid({ cells, todayIso, firstDayOfWeek }: { cells: HeatCell[]; todayIso: string; firstDayOfWeek: number }) {
  const { t } = useTranslation();
  // Year-month ("YYYY-MM") whose cells are highlighted while its month label is
  // hovered; null when nothing is hovered.
  const [hoverYm, setHoverYm] = useState<string | null>(null);
  if (cells.length === 0) return null;

  // Pad the front with blank cells so the grid starts on the configured first
  // weekday and the columns line up as full weeks in oldest..today order.
  const pad: HeatCell[] = Array.from({ length: weekPosition(cells[0].iso, firstDayOfWeek) }, () => ({
    iso: "", status: "none" as const,
  }));

  // Group into weeks of 7, oldest first.
  const weeks: HeatCell[][] = [];
  const all = [...pad, ...cells];
  for (let i = 0; i < all.length; i += 7) {
    weeks.push(all.slice(i, i + 7));
  }

  // Per-week month header: `ym` is the week's year-month (for hover highlighting),
  // `label` is its display name — blank when it repeats the previous week's month
  // so the name only changes when the month does (GitHub-style).
  const monthHeaders = weeks.map((w, wi) => {
    const first = w.find(c => c.iso);
    if (!first) return { ym: "", label: "" };
    const ym = first.iso.slice(0, 7);
    const m = Number(first.iso.slice(5, 7));
    const prev = wi > 0 ? weeks[wi - 1].find(c => c.iso) : undefined;
    const prevM = prev ? Number(prev.iso.slice(5, 7)) : 0;
    return { ym, label: m === prevM ? "" : monthName(m) };
  });

  const fmtDate = (iso: string) => {
    const d = new Date(`${iso}T00:00:00Z`);
    return formatDate(d, "slash_ymd", currentLocale());
  };

  return (
    <div className="heatmap" role="table" aria-label={t("recurrence.heatmapAria")}>
      <div className="heatmap-months" role="row">
        {monthHeaders.map((mh, i) => (
          <span key={i} className="heatmap-month"
                onMouseEnter={() => mh.ym && setHoverYm(mh.ym)}
                onMouseLeave={() => setHoverYm(prev => (prev === mh.ym ? null : prev))}>
            {mh.label}
          </span>
        ))}
      </div>
      <div className="heatmap-body">
        <div className="heatmap-weekdays">
          {Array.from({ length: 7 }, (_, i) => WEEKDAY_KEYS[(firstDayOfWeek + i) % 7]).map((k, i) => (
            <span key={i} className="heatmap-weekday">{t(k).slice(0, 1)}</span>
          ))}
        </div>
        <div className="heatmap-weeks" role="rowgroup">
          {weeks.map((week, wi) => (
            <div className="heatmap-week" role="row" key={wi}>
              {week.map((cell, ci) => {
                if (!cell.iso) {
                  return <span key={ci} className="heatmap-cell heatmap-pad" aria-hidden="true" />;
                }
                const isToday = cell.iso === todayIso;
                const hl = hoverYm != null && cell.iso.slice(0, 7) === hoverYm;
                const cls = `heatmap-cell heatmap-${cell.status}${isToday ? " heatmap-today" : ""}${hl ? " heatmap-hl" : ""}`;
                const label = t(`recurrence.tip${cap(cell.status)}`, { date: fmtDate(cell.iso) });
                return (
                  <span
                    key={ci}
                    role="cell"
                    className={cls}
                    title={label}
                    aria-label={label}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Combine per-template heatmaps that share a recurrence tag into one series. The
 *  maps are day-aligned (same range), so a day is "done" if any template did it,
 *  "skip" if any scheduled it without a completion, else "none". Done/skip never
 *  conflict for a given day since detection is tag-based (identical across the
 *  group), so OR-ing the statuses is well-defined. */
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

const MONTH_NAMES_EN = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
function monthName(m: number): string {
  return MONTH_NAMES_EN[m - 1] ?? "";
}