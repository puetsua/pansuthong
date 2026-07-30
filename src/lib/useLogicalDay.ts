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
 * The once-a-minute check sets state unconditionally and lets React bail out when the
 * string is unchanged, so it costs a comparison per minute and re-renders exactly once
 * per rollover. The visibility listener covers the case the interval is worst at —
 * timers are throttled or suspended while the machine sleeps, so a boundary crossed
 * overnight would otherwise wait up to a tick after resume.
 */
export function useLogicalDay(dayStartHour: number): string {
  // Derived during render, not held in state, so a changed `dayStartHour` takes effect
  // on the very same render. That matters on launch: the document loads a moment after
  // the first render, and a night owl opening the app at 02:00 with a 4am start would
  // otherwise get one committed frame showing the wrong day before an effect corrected
  // it — a flash aimed squarely at the users who set the option.
  // Reading the clock in render is deliberate — do not "fix" this into state.
  const day = todayIso(new Date(), dayStartHour);
  // The state exists only to schedule a re-render at the boundary; its value is never
  // read. Passing an unchanged string makes React bail out, so a tick that does not
  // cross a boundary renders nothing.
  const [, observe] = useState(day);

  useEffect(() => {
    const sync = () => observe(todayIso(new Date(), dayStartHour));

    // Realign the bail-out baseline first. It was seeded on an earlier render, which
    // may have used a different `dayStartHour` — the document carries the setting and
    // loads after the first render. A baseline computed under the old hour can equal
    // the *next* day's value, which would make React bail out on the tick that
    // actually crosses the boundary and swallow the rollover entirely.
    sync();

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
