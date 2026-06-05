import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Tag, Task } from "../lib/tauri";
import { TaskRow } from "./TaskRow";

vi.mock("../lib/tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/tauri")>();
  return {
    ...actual,
    api: {
      setTaskDone: vi.fn().mockResolvedValue({}),
      addTask: vi.fn().mockResolvedValue({}),
      startTimer: vi.fn().mockResolvedValue({}),
      stopTimer: vi.fn().mockResolvedValue({}),
    },
  };
});

vi.mock("../lib/sound", () => ({ playCompletionSound: vi.fn() }));

import { api } from "../lib/tauri";
import { playCompletionSound } from "../lib/sound";

const baseTask: Task = {
  id: "k_1", title: "Write report",
  notes: "", tag_ids: [], created_at: "1970-01-01T00:00:00Z",
};
const tags = new Map<string, Tag>();

beforeEach(() => vi.clearAllMocks());

describe("TaskRow active mode", () => {
  it("toggles done via the checkbox", async () => {
    render(<TaskRow task={baseTask} tags={tags} todayIso="2026-05-31" />);
    fireEvent.click(screen.getByRole("checkbox", { name: /toggle/i }));
    await waitFor(() => expect(api.setTaskDone).toHaveBeenCalledWith("k_1", true));
  });

  it("plays the completion sound when marking a task done (#80)", async () => {
    render(<TaskRow task={baseTask} tags={tags} todayIso="2026-05-31" />);
    fireEvent.click(screen.getByRole("checkbox", { name: /toggle/i }));
    await waitFor(() => expect(playCompletionSound).toHaveBeenCalledTimes(1));
  });

  it("does not play the completion sound when reopening a done task (#80)", async () => {
    const done: Task = { ...baseTask, completed_at: "2026-05-31T10:00:00Z" };
    render(<TaskRow task={done} tags={tags} todayIso="2026-05-31" />);
    fireEvent.click(screen.getByRole("checkbox", { name: /toggle/i }));
    await waitFor(() => expect(api.setTaskDone).toHaveBeenCalledWith("k_1", false));
    expect(playCompletionSound).not.toHaveBeenCalled();
  });
});

describe("TaskRow time tracking (#81)", () => {
  it("starts a timer when not running", async () => {
    render(<TaskRow task={baseTask} tags={tags} todayIso="2026-05-31" />);
    fireEvent.click(screen.getByRole("button", { name: /start timer/i }));
    await waitFor(() => expect(api.startTimer).toHaveBeenCalledWith("k_1"));
  });

  it("stops the running timer and shows the live elapsed clock", async () => {
    const running: Task = { ...baseTask, time_entries: [{ id: "te_1", start: "2026-05-31T10:00:00+08:00" }] };
    render(<TaskRow task={running} tags={tags} todayIso="2026-05-31" />);
    // The button is labelled "Stop timer" while running.
    fireEvent.click(screen.getByRole("button", { name: /stop timer/i }));
    await waitFor(() => expect(api.stopTimer).toHaveBeenCalledWith("k_1"));
  });

  it("shows a tracked total (not the start icon's clock) when stopped with recorded time", () => {
    const tracked: Task = {
      ...baseTask,
      time_entries: [{ id: "te_1", start: "2026-05-31T10:00:00+08:00", end: "2026-05-31T11:30:00+08:00" }],
    };
    render(<TaskRow task={tracked} tags={tags} todayIso="2026-05-31" />);
    expect(screen.getByText("1h 30m")).toBeTruthy();
    expect(screen.getByRole("button", { name: /start timer/i })).toBeTruthy();
  });
});

describe("TaskRow time-of-day (#93)", () => {
  it("shows the scheduled time when present", () => {
    render(<TaskRow task={{ ...baseTask, start_date: "2026-06-05", start_time: "09:30" }}
                    tags={tags} todayIso="2026-05-31" />);
    expect(screen.getByText(/06-05 09:30/)).toBeTruthy();
  });

  it("appends the due time to the due label", () => {
    render(<TaskRow task={{ ...baseTask, due_date: "2026-06-05", due_time: "17:00" }}
                    tags={tags} todayIso="2026-05-31" />);
    expect(screen.getByText(/due 06-05 17:00/)).toBeTruthy();
  });

  it("stays all-day (no time text) when no time is set", () => {
    render(<TaskRow task={{ ...baseTask, start_date: "2026-06-05" }}
                    tags={tags} todayIso="2026-05-31" />);
    expect(screen.getByText("06-05")).toBeTruthy();
  });
});

describe("TaskRow archived mode (#23)", () => {
  // In the Archived view the row offers a single "Restore" action instead of a
  // done-checkbox. Restoring always clears completion, which un-archives the task
  // (completion and archival are the same `completed_at` state).
  const archivedTask: Task = { ...baseTask, completed_at: "2025-05-23T12:00:00Z" };

  it("shows a Restore button instead of a checkbox", () => {
    render(<TaskRow task={archivedTask} tags={tags} todayIso="2026-05-31" archived />);
    expect(screen.getByRole("button", { name: /restore/i })).toBeTruthy();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("restores an archived task by clearing completion", async () => {
    render(<TaskRow task={archivedTask} tags={tags} todayIso="2026-05-31" archived />);
    fireEvent.click(screen.getByRole("button", { name: /restore/i }));
    await waitFor(() => expect(api.setTaskDone).toHaveBeenCalledWith("k_1", false));
  });
});
