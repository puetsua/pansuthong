import { useEffect, useState } from "react";
import { todayIso } from "./dates";

/**
 * How often the logical day is re-derived from the clock. The answer is recomputed
 * from scratch each tick rather than scheduled at the boundary, so DST shifts, a
 * manually changed system clock, and an edited `day_start_hour` all self-correct
 * within one tick instead of needing their own arithmetic (#148).
 */
const CHECK_MS = 60_000;

/**
 * The current logical day (YYYY-MM-DD), advancing on its own as wall-clock time
 * crosses `dayStartHour`. Without this the day is sampled once when the indexes are
 * built and an app left open overnight keeps showing yesterday's Today view.
 *
 * State is set only when the derived string actually changes, so the once-a-minute
 * check costs a string comparison and re-renders exactly once per rollover. The
 * visibility listener covers the case the interval is worst at — timers are throttled
 * or suspended while the machine sleeps, so a boundary crossed overnight would
 * otherwise wait up to a tick after resume.
 */
export function useLogicalDay(dayStartHour: number): string {
  const [day, setDay] = useState(() => todayIso(new Date(), dayStartHour));

  useEffect(() => {
    const sync = () => setDay(prev => {
      const next = todayIso(new Date(), dayStartHour);
      return next === prev ? prev : next;
    });

    sync(); // dayStartHour may have just changed
    const id = setInterval(sync, CHECK_MS);
    const onVisible = () => { if (!document.hidden) sync(); };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [dayStartHour]);

  return day;
}
