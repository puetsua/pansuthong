import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Task } from "../lib/tauri";
import { AFK_THRESHOLD_MS, requestStopTimer } from "../lib/afkWhileTracking";

vi.mock("../lib/tauri", async importOriginal => {
  const actual = await importOriginal<typeof import("../lib/tauri")>();
  return {
    ...actual,
    api: {
      sessionIdleMs: vi.fn(),
      discardRunningAfk: vi.fn().mockResolvedValue(undefined),
      stopTimer: vi.fn().mockResolvedValue({}),
    },
  };
});

import { api } from "../lib/tauri";
import { AfkWhileTracking } from "./AfkWhileTracking";

const idleMock = vi.mocked(api.sessionIdleMs);
const discardMock = vi.mocked(api.discardRunningAfk);
const stopMock = vi.mocked(api.stopTimer);

const NOW = Date.parse("2026-06-08T10:20:00+08:00");
const THRESHOLD = AFK_THRESHOLD_MS;

const running = (id: string, start: string): Task => ({
  id,
  title: id,
  notes: "",
  tag_ids: [],
  created_at: start,
  time_entries: [{ id: `te_${id}`, start }],
});

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

describe("AfkWhileTracking (#170)", () => {
  beforeEach(() => {
    // Fake Date + interval so return-from-AFK can be advanced; leave setTimeout
    // real so waitFor still ticks.
    vi.useFakeTimers({
      toFake: ["Date", "setInterval", "clearInterval"],
    });
    vi.setSystemTime(NOW);
    idleMock.mockReset();
    discardMock.mockClear();
    stopMock.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("does not prompt when last-input idle is unavailable", async () => {
    idleMock.mockResolvedValue(null);
    render(<AfkWhileTracking tasks={[running("k_1", "2026-06-08T10:00:00+08:00")]} />);
    await flush();
    expect(screen.queryByRole("dialog")).toBeNull();
    await requestStopTimer("k_1");
    expect(stopMock).toHaveBeenCalledWith("k_1");
  });

  it("keeps AFK time and continues the timer after return", async () => {
    idleMock.mockResolvedValue(THRESHOLD + 60_000);
    render(<AfkWhileTracking tasks={[running("k_1", "2026-06-08T10:00:00+08:00")]} />);
    await flush();
    idleMock.mockResolvedValue(0);
    await act(async () => {
      vi.advanceTimersByTime(1_000);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByRole("dialog", { name: /away from keyboard/i }).textContent).toMatch(/6m/);
    fireEvent.click(screen.getByRole("button", { name: "Keep" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(discardMock).not.toHaveBeenCalled();
    expect(stopMock).not.toHaveBeenCalled();
  });

  it("discards AFK time on every running task after return", async () => {
    idleMock.mockResolvedValue(THRESHOLD + 60_000);
    render(<AfkWhileTracking tasks={[
      running("k_1", "2026-06-08T10:00:00+08:00"),
      running("k_2", "2026-06-08T10:01:00+08:00"),
    ]} />);
    await flush();
    idleMock.mockResolvedValue(0);
    await act(async () => {
      vi.advanceTimersByTime(1_000);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByRole("dialog").textContent).toMatch(/2 running timers/);
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(discardMock).toHaveBeenCalledWith(NOW - (THRESHOLD + 60_000)));
    expect(stopMock).not.toHaveBeenCalled();
  });

  it("intercepts Stop after AFK: Keep then stops that task at now", async () => {
    idleMock.mockResolvedValue(THRESHOLD + 60_000);
    render(<AfkWhileTracking tasks={[
      running("k_1", "2026-06-08T10:00:00+08:00"),
      running("k_2", "2026-06-08T10:01:00+08:00"),
    ]} />);
    await act(async () => { await requestStopTimer("k_1"); });
    expect(stopMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Keep" }));
    await waitFor(() => expect(stopMock).toHaveBeenCalledWith("k_1"));
    expect(stopMock).toHaveBeenCalledTimes(1);
    expect(discardMock).not.toHaveBeenCalled();
  });

  it("intercepts Stop after AFK: Discard closes at AFK start without stop_timer", async () => {
    idleMock.mockResolvedValue(THRESHOLD + 60_000);
    render(<AfkWhileTracking tasks={[running("k_1", "2026-06-08T10:00:00+08:00")]} />);
    await act(async () => { await requestStopTimer("k_1"); });
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(discardMock).toHaveBeenCalledWith(NOW - (THRESHOLD + 60_000)));
    expect(stopMock).not.toHaveBeenCalled();
  });

  it("Stop while the return prompt is open then Keep stops that task", async () => {
    idleMock.mockResolvedValue(THRESHOLD + 60_000);
    render(<AfkWhileTracking tasks={[running("k_1", "2026-06-08T10:00:00+08:00")]} />);
    await flush();
    idleMock.mockResolvedValue(0);
    await act(async () => {
      vi.advanceTimersByTime(1_000);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByRole("dialog")).toBeTruthy();
    await act(async () => { await requestStopTimer("k_1"); });
    fireEvent.click(screen.getByRole("button", { name: "Keep" }));
    await waitFor(() => expect(stopMock).toHaveBeenCalledWith("k_1"));
    expect(discardMock).not.toHaveBeenCalled();
  });

  it("keeps the dialog and shows an error if Discard fails", async () => {
    idleMock.mockResolvedValue(THRESHOLD);
    discardMock.mockRejectedValueOnce("disk full");
    render(<AfkWhileTracking tasks={[running("k_1", "2026-06-08T10:00:00+08:00")]} />);
    await act(async () => { await requestStopTimer("k_1"); });
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/disk full/);
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});
