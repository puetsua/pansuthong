import type { Settings } from "../../lib/tauri";

/** Settings write used by every Settings section. Failures are surfaced by the parent. */
export type ApplySettings = (patch: Partial<Settings>) => void | Promise<void>;
