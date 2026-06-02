import { useCallback, useState } from "react";
import { Task, isDone } from "../lib/tauri";

/**
 * Keeps tasks completed during a view's current mount visible (rendered completed,
 * so the checkbox can be unticked to undo) instead of vanishing the instant they're
 * checked. The held set is component-local, so it clears the moment the view
 * unmounts — i.e. when the user navigates to another view or refreshes the page —
 * matching the spec: a completed task lingers for recovery, then is dropped on the
 * next visit. Today uses a date-based rule (see `buildIndexes.today`) and does NOT
 * use this; it lingers completions until the day rolls over instead.
 */
export function useHeldCompletions(allTasks: Task[]) {
  const [heldIds, setHeldIds] = useState<ReadonlySet<string>>(() => new Set());

  const onCompleted = useCallback((id: string) => {
    setHeldIds(s => {
      if (s.has(id)) return s;
      const next = new Set(s);
      next.add(id);
      return next;
    });
  }, []);

  // Reopening (or completing-then-undoing) drops the task from the held set, so it
  // returns to its normal place in the active list instead of sticking to the bottom.
  const onReopened = useCallback((id: string) => {
    setHeldIds(s => {
      if (!s.has(id)) return s;
      const next = new Set(s);
      next.delete(id);
      return next;
    });
  }, []);

  // Resolve ids to their current task objects, keeping only those still completed.
  // A reopened or deleted task drops out naturally.
  const byId = new Map(allTasks.map(t => [t.id, t]));
  const held = [...heldIds]
    .map(id => byId.get(id))
    .filter((t): t is Task => t != null && isDone(t));

  return { held, onCompleted, onReopened };
}

/**
 * Append held (completed) tasks after an active list, skipping any already present.
 * Completed tasks sort below open ones, so appending keeps them at the bottom.
 */
export function withHeld(active: Task[], held: Task[]): Task[] {
  if (held.length === 0) return active;
  const present = new Set(active.map(t => t.id));
  return [...active, ...held.filter(t => !present.has(t.id))];
}
