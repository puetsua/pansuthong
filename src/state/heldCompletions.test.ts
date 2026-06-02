import { describe, it, expect } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { Task } from "../lib/tauri";
import { useHeldCompletions, withHeld } from "./heldCompletions";

const task = (id: string, done: boolean): Task => ({
  id, title: id, notes: "", tag_ids: [], created_at: "1970-01-01T00:00:00Z",
  completed_at: done ? "2026-06-02T10:00:00+08:00" : undefined,
});

describe("useHeldCompletions (#recover)", () => {
  it("holds a completed task, then drops it on reopen", () => {
    const allTasks = [task("k_1", true)];
    const { result } = renderHook(() => useHeldCompletions(allTasks));

    expect(result.current.held).toEqual([]);

    act(() => result.current.onCompleted("k_1"));
    expect(result.current.held.map(t => t.id)).toEqual(["k_1"]);

    act(() => result.current.onReopened("k_1"));
    expect(result.current.held).toEqual([]);
  });

  it("ignores a held id whose task is no longer completed (e.g. reopened elsewhere)", () => {
    // Held by id, but the resolved task is active -> excluded from `held`.
    const { result, rerender } = renderHook(({ tasks }) => useHeldCompletions(tasks), {
      initialProps: { tasks: [task("k_1", true)] },
    });
    act(() => result.current.onCompleted("k_1"));
    expect(result.current.held.map(t => t.id)).toEqual(["k_1"]);

    rerender({ tasks: [task("k_1", false)] });
    expect(result.current.held).toEqual([]);
  });

  it("drops a held id whose task vanished from the document", () => {
    const { result, rerender } = renderHook(({ tasks }) => useHeldCompletions(tasks), {
      initialProps: { tasks: [task("k_1", true)] },
    });
    act(() => result.current.onCompleted("k_1"));
    rerender({ tasks: [] });
    expect(result.current.held).toEqual([]);
  });
});

describe("withHeld", () => {
  it("appends held tasks after the active list (so they sit at the bottom)", () => {
    const active = [task("a", false), task("b", false)];
    const held = [task("c", true)];
    expect(withHeld(active, held).map(t => t.id)).toEqual(["a", "b", "c"]);
  });

  it("does not duplicate a task already present in the active list", () => {
    const active = [task("a", false)];
    const held = [task("a", true)]; // same id (e.g. transient overlap)
    expect(withHeld(active, held).map(t => t.id)).toEqual(["a"]);
  });

  it("returns the active list unchanged when nothing is held", () => {
    const active = [task("a", false)];
    expect(withHeld(active, [])).toBe(active);
  });
});
