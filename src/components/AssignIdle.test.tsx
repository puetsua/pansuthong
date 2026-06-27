import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ComponentProps } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { Task } from "../lib/tauri";
import { AssignIdle } from "./AssignIdle";

vi.mock("../lib/tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/tauri")>();
  return {
    ...actual,
    api: {
      addTimeEntry: vi.fn().mockResolvedValue({}),
      updateTimeEntry: vi.fn().mockResolvedValue({}),
    },
  };
});

// Pin the app-session start so the idle anchor is deterministic regardless of the
// real wall clock; "now" is then controlled per-test with fake timers.
vi.mock("../lib/session", () => ({ SESSION_START_MS: Date.parse("2026-06-02T08:00:00Z") }));

import { api } from "../lib/tauri";

const base: Task = { id: "k_1", title: "t", notes: "", tag_ids: [], created_at: "1970-01-01T00:00:00Z" };
const candA = { ...base, id: "k_a", title: "Task A" };
const candB = { ...base, id: "k_b", title: "Task B" };
const withEntry = (...entries: { id: string; start: string; end?: string }[]): Task => ({ ...candA, time_entries: entries });

const at = (iso: string) => Date.parse(iso);
const sessionAnchor = at("2026-06-02T08:00:00Z");
const addCalls = () => (api.addTimeEntry as ReturnType<typeof vi.fn>).mock.calls;
const updateCalls = () => (api.updateTimeEntry as ReturnType<typeof vi.fn>).mock.calls;
const renderAssignIdle = (
  props: Partial<ComponentProps<typeof AssignIdle>> & Pick<ComponentProps<typeof AssignIdle>, "tasks" | "candidates">,
) => render(
  <AssignIdle
    idleAnchorMs={sessionAnchor}
    onClose={() => {}}
    {...props}
  />,
);

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe("AssignIdle (#idle-timer)", () => {
  it("adds a new entry spanning the full idle window by default", () => {
    vi.setSystemTime(new Date("2026-06-02T10:00:00Z"));
    renderAssignIdle({ tasks: [base], candidates: [candA, candB] });
    fireEvent.click(screen.getByRole("button", { name: "Task" })); // open the dropdown
    fireEvent.click(screen.getByText("Task B"));
    fireEvent.click(screen.getByRole("button", { name: "Assign" }));

    expect(updateCalls().length).toBe(0);
    expect(addCalls().length).toBe(1);
    const [taskId, startMs, endMs] = addCalls()[0];
    expect(taskId).toBe("k_b");
    // Full window: session start (08:00) .. now (10:00).
    expect(startMs).toBe(at("2026-06-02T08:00:00Z"));
    expect(endMs).toBe(at("2026-06-02T10:00:00Z"));
  });

  it("concatenates into an adjacent entry at full duration", () => {
    // Existing 09:00–10:00; anchor lands at 10:00, so the full-window start touches
    // it and the span extends that entry instead of adding a new one.
    vi.setSystemTime(new Date("2026-06-02T10:45:00Z"));
    const task = withEntry({ id: "x", start: "2026-06-02T09:00:00Z", end: "2026-06-02T10:00:00Z" });
    renderAssignIdle({ tasks: [task], candidates: [task] });
    fireEvent.click(screen.getByRole("button", { name: "Assign" }));

    expect(addCalls().length).toBe(0);
    expect(updateCalls().length).toBe(1);
    const [taskId, entryId, patch] = updateCalls()[0];
    expect(taskId).toBe("k_a");
    expect(entryId).toBe("x");
    expect(patch.start).toBe(at("2026-06-02T09:00:00Z")); // original start kept
    expect(patch.end).toBe(at("2026-06-02T10:45:00Z"));   // extended to now
  });

  it("records a separate entry once the slider trims the start past the gap", () => {
    vi.setSystemTime(new Date("2026-06-02T10:45:00Z"));
    const task = withEntry({ id: "x", start: "2026-06-02T09:00:00Z", end: "2026-06-02T10:00:00Z" });
    renderAssignIdle({ tasks: [task], candidates: [task] });
    // 30 min: start = 10:45 − 0:30 = 10:15, which is 15 min past the entry's end.
    fireEvent.change(screen.getByLabelText("Duration to assign"), { target: { value: "1800" } });
    fireEvent.click(screen.getByRole("button", { name: "Assign" }));

    expect(updateCalls().length).toBe(0);
    expect(addCalls().length).toBe(1);
    const [, startMs, endMs] = addCalls()[0];
    expect(startMs).toBe(at("2026-06-02T10:15:00Z"));
    expect(endMs).toBe(at("2026-06-02T10:45:00Z"));
  });

  it("lets the duration be typed, to second resolution", () => {
    vi.setSystemTime(new Date("2026-06-02T12:00:00Z")); // 4h window
    renderAssignIdle({ tasks: [base], candidates: [candA] });
    fireEvent.change(screen.getByLabelText("Duration"), { target: { value: "90s" } });
    fireEvent.click(screen.getByRole("button", { name: "Assign" }));

    const [, startMs, endMs] = addCalls()[0];
    expect(endMs - startMs).toBe(90_000); // exactly 90 seconds
  });

  it("clamps a typed duration that overflows the idle window", () => {
    vi.setSystemTime(new Date("2026-06-02T10:45:00Z")); // window: 08:00 → 10:45 = 2h45m
    renderAssignIdle({ tasks: [base], candidates: [candA] });
    fireEvent.change(screen.getByLabelText("Duration"), { target: { value: "10h" } });
    fireEvent.click(screen.getByRole("button", { name: "Assign" }));

    const [, startMs, endMs] = addCalls()[0];
    // Clamped to the full window rather than running before the session start.
    expect(startMs).toBe(at("2026-06-02T08:00:00Z"));
    expect(endMs).toBe(at("2026-06-02T10:45:00Z"));
  });

  it("starts the assignment window at a reset idle anchor when it is newer", () => {
    vi.setSystemTime(new Date("2026-06-02T10:45:00Z"));
    const resetAnchor = at("2026-06-02T10:30:00Z");
    renderAssignIdle({ tasks: [base], candidates: [candA], idleAnchorMs: resetAnchor });
    fireEvent.click(screen.getByRole("button", { name: "Assign" }));

    const [, startMs, endMs] = addCalls()[0];
    expect(startMs).toBe(resetAnchor);
    expect(endMs).toBe(at("2026-06-02T10:45:00Z"));
  });

  it("keeps Reset and extra helper text out of the inline assignment row", () => {
    vi.setSystemTime(new Date("2026-06-02T10:45:00Z"));
    renderAssignIdle({ tasks: [base], candidates: [candA] });

    expect(screen.queryByText("Assign idle time")).toBeNull();
    expect(screen.queryByRole("button", { name: "Reset" })).toBeNull();
  });
});
