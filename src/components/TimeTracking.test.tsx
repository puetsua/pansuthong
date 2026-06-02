import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Task } from "../lib/tauri";
import { TimeTracking } from "./TimeTracking";

vi.mock("../lib/tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/tauri")>();
  return {
    ...actual,
    api: {
      startTimer: vi.fn().mockResolvedValue({}),
      stopTimer: vi.fn().mockResolvedValue({}),
      addTimeEntry: vi.fn().mockResolvedValue({}),
      updateTimeEntry: vi.fn().mockResolvedValue({}),
      deleteTimeEntry: vi.fn().mockResolvedValue({}),
    },
  };
});

import { api } from "../lib/tauri";

const base: Task = { id: "k_1", title: "t", notes: "", tag_ids: [], created_at: "1970-01-01T00:00:00Z" };
const closed = { id: "te_1", start: "2026-06-02T09:00:00+08:00", end: "2026-06-02T10:00:00+08:00" };

beforeEach(() => vi.clearAllMocks());

describe("TimeTracking (#81)", () => {
  it("starts the timer when none is running", async () => {
    render(<TimeTracking task={base} />);
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await waitFor(() => expect(api.startTimer).toHaveBeenCalledWith("k_1"));
  });

  it("stops a running timer", async () => {
    const running: Task = { ...base, time_entries: [{ id: "te_x", start: "2026-06-02T10:00:00+08:00" }] };
    render(<TimeTracking task={running} />);
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    await waitFor(() => expect(api.stopTimer).toHaveBeenCalledWith("k_1"));
  });

  it("lists an entry with its duration and deletes it", async () => {
    render(<TimeTracking task={{ ...base, time_entries: [closed] }} />);
    // "1h 0m" shows twice: the running total and this entry's duration.
    expect(screen.getAllByText("1h 0m").length).toBe(2);
    fireEvent.click(screen.getByRole("button", { name: /delete entry/i }));
    await waitFor(() => expect(api.deleteTimeEntry).toHaveBeenCalledWith("k_1", "te_1"));
  });

  it("edits an entry's times", async () => {
    render(<TimeTracking task={{ ...base, time_entries: [closed] }} />);
    fireEvent.click(screen.getByRole("button", { name: /edit entry/i }));
    fireEvent.change(screen.getByLabelText("Entry end"), { target: { value: "2026-06-02T11:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.updateTimeEntry).toHaveBeenCalledWith(
      "k_1", "te_1", expect.objectContaining({ end: Date.parse("2026-06-02T11:00") }),
    ));
  });

  it("rejects an entry whose end is not after its start", async () => {
    render(<TimeTracking task={base} />);
    fireEvent.click(screen.getByRole("button", { name: "Add entry" }));
    fireEvent.change(screen.getByLabelText("New entry start"), { target: { value: "2026-06-02T10:00" } });
    fireEvent.change(screen.getByLabelText("New entry end"), { target: { value: "2026-06-02T09:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByText(/end must be after start/i)).toBeTruthy();
    expect(api.addTimeEntry).not.toHaveBeenCalled();
  });

  it("adds a valid manual entry", async () => {
    render(<TimeTracking task={base} />);
    fireEvent.click(screen.getByRole("button", { name: "Add entry" }));
    fireEvent.change(screen.getByLabelText("New entry start"), { target: { value: "2026-06-02T09:00" } });
    fireEvent.change(screen.getByLabelText("New entry end"), { target: { value: "2026-06-02T10:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(api.addTimeEntry).toHaveBeenCalledWith(
      "k_1", Date.parse("2026-06-02T09:00"), Date.parse("2026-06-02T10:00"),
    ));
  });

  it("keeps second precision in a manual entry (step=1 inputs)", async () => {
    render(<TimeTracking task={base} />);
    fireEvent.click(screen.getByRole("button", { name: "Add entry" }));
    const start = screen.getByLabelText("New entry start") as HTMLInputElement;
    expect(start.step).toBe("1"); // browser exposes a seconds field
    fireEvent.change(start, { target: { value: "2026-06-02T09:00:30" } });
    fireEvent.change(screen.getByLabelText("New entry end"), { target: { value: "2026-06-02T09:01:45" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(api.addTimeEntry).toHaveBeenCalledWith(
      "k_1", Date.parse("2026-06-02T09:00:30"), Date.parse("2026-06-02T09:01:45"),
    ));
  });
});
