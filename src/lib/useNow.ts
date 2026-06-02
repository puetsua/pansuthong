import { useEffect, useState } from "react";

/**
 * Current epoch-ms, re-rendering once a second **only while `active`** so a running
 * timer's display ticks without burning a permanent interval (#81). When `active`
 * is false the value is sampled once and left alone.
 */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now()); // resync immediately when timing starts
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}
