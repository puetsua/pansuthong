import { Decision, TaskDiff } from "../lib/tauri";

export type BulkIntent = "mine" | "theirs";

/**
 * Map a bulk "use all mine" / "use all theirs" intent onto a single row,
 * always returning an action that row actually offers. A blanket assignment
 * (e.g. `keep_mine` on a theirs-only row) highlights no Pick yet still submits,
 * which the backend silently interprets as a drop of the wrong side (#31).
 */
export function bulkAction(diff: TaskDiff, intent: BulkIntent): Decision["action"] {
  switch (diff.kind) {
    case "differs":
      return intent === "mine" ? "keep_mine" : "keep_theirs";
    case "only_mine":
      // offers keep_mine / drop
      return intent === "mine" ? "keep_mine" : "drop";
    case "only_theirs":
      // offers keep_theirs / drop
      return intent === "theirs" ? "keep_theirs" : "drop";
  }
}

/**
 * The next conflict to visit after the current one is resolved or dismissed,
 * or `null` when none remain. Skips the current path defensively in case it is
 * still listed (#37).
 */
export function nextConflictPath(remaining: string[], current: string): string | null {
  return remaining.find(p => p !== current) ?? null;
}
