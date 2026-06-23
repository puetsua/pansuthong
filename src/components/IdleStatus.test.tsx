import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Task } from "../lib/tauri";
import { IdleStatus } from "./IdleStatus";

const base: Task = { id: "k_1", title: "t", notes: "", tag_ids: [], created_at: "1970-01-01T00:00:00Z" };
const closed: Task = { ...base, time_entries: [{ id: "te_1", start: "2026-06-02T09:00:00+08:00", end: "2026-06-02T10:00:00+08:00" }] };
const running = (id: string, start: string): Task => ({ ...base, id, time_entries: [{ id: `te_${id}`, start }] });

describe("IdleStatus (#idle-timer)", () => {
  it("shows the idle label when no timer is running", () => {
    render(<IdleStatus tasks={[closed]} />);
    expect(screen.getByText(/Idle/)).toBeTruthy();
  });

  it("shows the tracking count and elapsed when timers are running", () => {
    const tasks = [running("a", "2026-06-02T11:00:00+08:00"), running("b", "2026-06-02T11:30:00+08:00")];
    render(<IdleStatus tasks={tasks} />);
    expect(screen.getByText(/Tracking 2 tasks/)).toBeTruthy();
  });

  it("renders plain text (no button) when assign is not offered", () => {
    render(<IdleStatus tasks={[closed]} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("is a clickable button that fires onAssign when assignable", () => {
    const onAssign = vi.fn();
    render(<IdleStatus tasks={[closed]} onAssign={onAssign} />);
    const btn = screen.getByRole("button");
    fireEvent.click(btn);
    expect(onAssign).toHaveBeenCalledTimes(1);
  });

  it("reads as pressed while the assign form is active", () => {
    render(<IdleStatus tasks={[closed]} onAssign={() => {}} active />);
    expect(screen.getByRole("button").getAttribute("aria-pressed")).toBe("true");
  });
});
