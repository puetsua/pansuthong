import { useEffect, useState } from "react";
import { msUntilNextLogicalDayBoundary, todayIso } from "./dates";

/**
 * Upper bound between timer wake-ups when the next rollover is far away. Each wake
 * re-derives the logical day from the clock so DST shifts, a manually changed system
 * clock, and an edited `day_start_hour` self-correct without bespoke arithmetic (#148).
 */
const MAX_CHECK_MS = 60_000;

/**
 * The current logical day (YYYY-MM-DD), advancing on its own as wall-clock time
 * crosses `dayStartHour`. Without this the day is sampled once when the indexes are
 * built and an app left open overnight keeps showing yesterday's Today view (#235).
 *
 * A timeout is scheduled for the next rollover (midnight or the configured day-start
 * hour) and capped wake-ups handle clock drift. `focus` and `visibilitychange` cover
 * sleep/throttling where timers were suspended overnight.
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
    let boundaryTimer: ReturnType<typeof setTimeout> | undefined;

    const sync = () => observe(todayIso(new Date(), dayStartHour));

    const schedule = () => {
      clearTimeout(boundaryTimer);
      const ms = msUntilNextLogicalDayBoundary(new Date(), dayStartHour);
      boundaryTimer = setTimeout(() => {
        sync();
        schedule();
      }, Math.min(ms, MAX_CHECK_MS));
    };

    // Realign the bail-out baseline first. It was seeded on an earlier render, which
    // may have used a different `dayStartHour` — the document carries the setting and
    // loads after the first render. A baseline computed under the old hour can equal
    // the *next* day's value, which would make React bail out on the tick that
    // actually crosses the boundary and swallow the rollover entirely.
    sync();
    schedule();

    const onResume = () => {
      if (!document.hidden) sync();
    };
    document.addEventListener("visibilitychange", onResume);
    window.addEventListener("focus", onResume);

    return () => {
      clearTimeout(boundaryTimer);
      document.removeEventListener("visibilitychange", onResume);
      window.removeEventListener("focus", onResume);
    };
  }, [dayStartHour]);

  return day;
}
