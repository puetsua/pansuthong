import { useEffect, useState } from "react";
import { isLinux } from "./platform";

let cached: boolean | null = null;
let pending: Promise<boolean> | null = null;

function loadLinuxDesktop(): Promise<boolean> {
  if (cached !== null) return Promise.resolve(cached);
  if (!pending) {
    pending = isLinux().then(v => {
      cached = v;
      return v;
    });
  }
  return pending;
}

/**
 * True on Linux desktop (Tauri `plugin-os` type `linux`). While unresolved,
 * returns null so callers can avoid native `type=date` until the OS is known.
 */
export function useLinuxDesktop(): boolean | null {
  const [linux, setLinux] = useState<boolean | null>(cached);
  useEffect(() => {
    let active = true;
    void loadLinuxDesktop().then(v => {
      if (active) setLinux(v);
    });
    return () => { active = false; };
  }, []);
  return linux;
}

/** Prefer the in-DOM task-editor picker (Linux / unknown OS during probe). */
export function usePreferInDomTaskEditorDatePicker(): boolean {
  const linux = useLinuxDesktop();
  return linux !== false;
}
