import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import type { ComponentProps } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { Task } from "../lib/tauri";
import { IdleStatus } from "./IdleStatus";

const base: Task = { id: "k_1", title: "t", notes: "", tag_ids: [], created_at: "1970-01-01T00:00:00Z" };
const closed: Task = { ...base, time_entries: [{ id: "te_1", start: "2026-06-02T09:00:00+08:00", end: "2026-06-02T10:00:00+08:00" }] };
const running = (id: string, start: string): Task => ({ ...base, id, time_entries: [{ id: `te_${id}`, start }] });
const idleAnchorMs = Date.parse("2026-06-02T08:00:00+08:00");
const renderStatus = (props: Partial<ComponentProps<typeof IdleStatus>> = {}) =>
  render(<IdleStatus tasks={[closed]} idleAnchorMs={idleAnchorMs} {...props} />);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-02T12:00:00+08:00"));
});

afterEach(() => vi.useRealTimers());

describe("IdleStatus (#idle-timer)", () => {
  it("shows the idle label when no timer is running", () => {
    renderStatus();
    expect(screen.getByText(/Idle/)).toBeTruthy();
  });

  it("shows the tracking count and elapsed when timers are running", () => {
    const tasks = [running("a", "2026-06-02T11:00:00+08:00"), running("b", "2026-06-02T11:30:00+08:00")];
    renderStatus({ tasks });
    expect(screen.getByText(/Tracking 2 tasks/)).toBeTruthy();
  });

  it("renders plain text (no button) when assign is not offered", () => {
    renderStatus();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("is a clickable button that fires onAssign when assignable", () => {
    const onAssign = vi.fn();
    renderStatus({ onAssign });
    const btn = screen.getByRole("button", { name: /Idle/ });
    fireEvent.click(btn);
    expect(onAssign).toHaveBeenCalledTimes(1);
  });

  it("reads as pressed while the assign form is active", () => {
    renderStatus({ onAssign: () => {}, active: true });
    expect(screen.getByRole("button", { name: /Idle/ }).getAttribute("aria-pressed")).toBe("true");
  });

  it("shows reset next to the idle timer only while the inline assign row is active", () => {
    const onResetIdle = vi.fn();
    const { rerender } = render(
      <IdleStatus tasks={[closed]} idleAnchorMs={idleAnchorMs} onAssign={() => {}} onResetIdle={onResetIdle} />,
    );
    expect(screen.queryByRole("button", { name: "Reset" })).toBeNull();

    rerender(
      <IdleStatus tasks={[closed]} idleAnchorMs={idleAnchorMs} onAssign={() => {}} onResetIdle={onResetIdle} active />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(onResetIdle).toHaveBeenCalledTimes(1);
  });

});
