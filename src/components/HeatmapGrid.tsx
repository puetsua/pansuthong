import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { HeatCell } from "../lib/recurrence-heatmap";

const WEEKDAY_KEYS = [
  "taskEditor.weekdaySun", "taskEditor.weekdayMon", "taskEditor.weekdayTue",
  "taskEditor.weekdayWed", "taskEditor.weekdayThu", "taskEditor.weekdayFri",
  "taskEditor.weekdaySat",
];

function weekPosition(iso: string, fdow: number): number {
  const [y, m, d] = iso.split("-").map(Number);
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return (js - fdow + 7) % 7;
}

type Props = {
  cells: HeatCell[];
  todayIso: string;
  firstDayOfWeek: number;
  ariaLabel: string;
  labelForCell: (cell: HeatCell) => string;
};

/** GitHub-style rolling heatmap, shared by recurrence and tag analytics. */
export function HeatmapGrid({ cells, todayIso, firstDayOfWeek, ariaLabel, labelForCell }: Props) {
  const { t } = useTranslation();
  const [hoverYm, setHoverYm] = useState<string | null>(null);
  if (cells.length === 0) return null;

  const pad: HeatCell[] = Array.from({ length: weekPosition(cells[0].iso, firstDayOfWeek) }, () => ({
    iso: "", status: "none" as const,
  }));

  const weeks: HeatCell[][] = [];
  const all = [...pad, ...cells];
  for (let i = 0; i < all.length; i += 7) {
    weeks.push(all.slice(i, i + 7));
  }

  const monthHeaders = weeks.map((w, wi) => {
    const first = w.find(c => c.iso);
    if (!first) return { ym: "", label: "" };
    const ym = first.iso.slice(0, 7);
    const m = Number(first.iso.slice(5, 7));
    const prev = wi > 0 ? weeks[wi - 1].find(c => c.iso) : undefined;
    const prevM = prev ? Number(prev.iso.slice(5, 7)) : 0;
    return { ym, label: m === prevM ? "" : monthName(m) };
  });

  return (
    <div className="heatmap" role="table" aria-label={ariaLabel}>
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

const MONTH_NAMES_EN = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
function monthName(m: number): string {
  return MONTH_NAMES_EN[m - 1] ?? "";
}
