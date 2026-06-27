import { useEffect, useState } from "react";
import { SESSION_START_MS } from "./session";

let currentIdleAnchorMs = SESSION_START_MS;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

/**
 * Current-session idle anchor. It starts at app launch and can be advanced by the
 * user without changing synced task history.
 */
export function useIdleAnchor(): { idleAnchorMs: number; resetIdleAnchor: () => void } {
  const [idleAnchorMs, setIdleAnchorMs] = useState(currentIdleAnchorMs);

  useEffect(() => {
    const listener = () => setIdleAnchorMs(currentIdleAnchorMs);
    listeners.add(listener);
    listener();
    return () => { listeners.delete(listener); };
  }, []);

  return {
    idleAnchorMs,
    resetIdleAnchor: () => {
      currentIdleAnchorMs = Date.now();
      notify();
    },
  };
}
