import { useTranslation } from "react-i18next";
import { Task } from "../lib/tauri";
import { formatClock, trackingStatus } from "../lib/time";
import { useNow } from "../lib/useNow";

type Props = {
  // All tasks (active + archived/done): a running timer or the last finished
  // entry can live on any of them, so idle/running detection scans everything.
  tasks: Task[];
  // When idle and there are tasks to assign to, the whole indicator becomes a
  // button that opens the assign form (`onAssign`). Omitted/false → plain text.
  onAssign?: () => void;
  // True while the assign form is open, so the button reads as pressed.
  active?: boolean;
  idleAnchorMs: number;
  onResetIdle?: () => void;
};

// Idle counts up; a running timer is active. Inline glyphs, matching the
// codebase's icon convention (e.g. the composer's "⋯").
const IDLE_ICON = "⏱";
const RUNNING_ICON = "▶";

/**
 * Header sub-line idle/tracking indicator (#idle-timer). Idle: a stopwatch icon
 * plus the time since the last activity (or app launch) — clickable to transfer
 * that idle span onto a task you forgot to track. Running: how many timers are
 * going and the longest elapsed.
 */
export function IdleStatus({ tasks, onAssign, active, idleAnchorMs, onResetIdle }: Props) {
  const { t } = useTranslation();
  const now = useNow(true); // tick every second so the counter advances live
  const status = trackingStatus(tasks, now, idleAnchorMs);

  if (status.kind === "running") {
    return (
      <span className="view-idle" data-running="true">
        {" · "}<span aria-hidden="true">{RUNNING_ICON}</span>{" "}
        {t("today.tracking", { count: status.count, time: formatClock(status.longestMs) })}
      </span>
    );
  }

  const label = t("today.idle", { time: formatClock(status.sinceMs) });
  return (
    <>
      {" · "}
      {onAssign ? (
        <span className="view-idle-actions">
          <button type="button" className="view-idle view-idle-btn" data-running="false"
                  aria-pressed={active} title={t("idle.assignAria")} onClick={onAssign}>
            <span aria-hidden="true">{IDLE_ICON}</span>{" "}{label}
          </button>
          {active && onResetIdle && (
            <button type="button" className="view-idle-reset"
                    title={t("idle.resetAria")} onClick={onResetIdle}>
              {t("idle.reset")}
            </button>
          )}
        </span>
      ) : (
        <span className="view-idle" data-running="false">
          <span aria-hidden="true">{IDLE_ICON}</span>{" "}{label}
        </span>
      )}
    </>
  );
}
