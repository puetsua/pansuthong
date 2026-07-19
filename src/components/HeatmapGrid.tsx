import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { HeatCell } from "../lib/recurrence-heatmap";
import { buildHeatmapWeeks, weeksFittingIn } from "../lib/heatmap-layout";

const WEEKDAY_KEYS = [
  "taskEditor.weekdaySun", "taskEditor.weekdayMon", "taskEditor.weekdayTue",
  "taskEditor.weekdayWed", "taskEditor.weekdayThu", "taskEditor.weekdayFri",
  "taskEditor.weekdaySat",
];

type Props = {
  cells: HeatCell[];
  todayIso: string;
  firstDayOfWeek: number;
  ariaLabel: string;
  labelForCell: (cell: HeatCell) => string;
};

/** GitHub-style rolling heatmap, shared by Dashboard and tag analytics. */
export function HeatmapGrid({ cells, todayIso, firstDayOfWeek, ariaLabel, labelForCell }: Props) {
  const { t } = useTranslation();
  const [hoverYm, setHoverYm] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  // null = show all (unmeasured / zero-size host like jsdom)
  const [maxWeeks, setMaxWeeks] = useState<number | null>(null);

  const weeks = buildHeatmapWeeks(cells, firstDayOfWeek);
  const visibleWeeks = maxWeeks == null ? weeks : weeks.slice(Math.max(0, weeks.length - maxWeeks));

  useEffect(() => {
    const root = rootRef.current;
    if (!root || weeks.length === 0) return;

    const measure = () => {
      const weekdays = root.querySelector<HTMLElement>(".heatmap-weekdays");
      const body = root.querySelector<HTMLElement>(".heatmap-body");
      const weeksEl = root.querySelector<HTMLElement>(".heatmap-weeks");
      const week = weeksEl?.querySelector<HTMLElement>(".heatmap-week");
      if (!weekdays || !body || !weeksEl || !week) return;

      const rootCs = getComputedStyle(root);
      const pad = parseFloat(rootCs.paddingLeft) + parseFloat(rootCs.paddingRight);
      const bodyGap = parseFloat(getComputedStyle(body).columnGap || getComputedStyle(body).gap) || 0;
      const weekGap = parseFloat(getComputedStyle(weeksEl).columnGap || getComputedStyle(weeksEl).gap) || 0;
      const clientW = root.clientWidth;
      const weekW = week.offsetWidth;
      // Unreliable layout (jsdom / hidden): keep full range.
      if (clientW <= 0 || weekW <= 0) {
        setMaxWeeks(null);
        return;
      }
      // Always derive from the root's constrained width. weeksEl.clientWidth can
      // equal the full content width when an ancestor still expands to fit.
      const weeksBudget = clientW - pad - weekdays.offsetWidth - bodyGap;
      const next = weeksFittingIn(weeksBudget, weekW, weekGap, weeks.length);
      setMaxWeeks(prev => (prev === next ? prev : next));
    };

    // After layout (and after CSS that constrains parents) so clientWidth is real.
    const raf = requestAnimationFrame(measure);
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(root);
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
    };
  }, [weeks.length, cells, firstDayOfWeek]);

  if (cells.length === 0) return null;

  const monthsShort = t("taskEditor.monthsShort", { returnObjects: true }) as string[];
  const monthName = (m: number): string => monthsShort[m - 1] ?? "";

  const monthHeaders = visibleWeeks.map((w, wi) => {
    const first = w.find(c => c.iso);
    if (!first) return { ym: "", label: "" };
    const ym = first.iso.slice(0, 7);
    const m = Number(first.iso.slice(5, 7));
    const prev = wi > 0 ? visibleWeeks[wi - 1].find(c => c.iso) : undefined;
    const prevM = prev ? Number(prev.iso.slice(5, 7)) : 0;
    return { ym, label: m === prevM ? "" : monthName(m) };
  });

  return (
    <div ref={rootRef} className="heatmap" role="table" aria-label={ariaLabel}>
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
          {visibleWeeks.map((week, wi) => (
            <div className="heatmap-week" role="row" key={wi}>
              {week.map((cell, ci) => {
                if (!cell.iso) {
                  return <span key={ci} className="heatmap-cell heatmap-pad" aria-hidden="true" />;
                }
                const isToday = cell.iso === todayIso;
                const hl = hoverYm != null && cell.iso.slice(0, 7) === hoverYm;
                const cls = `heatmap-cell heatmap-${cell.status}${isToday ? " heatmap-today" : ""}${hl ? " heatmap-hl" : ""}`;
                const label = labelForCell(cell);
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
