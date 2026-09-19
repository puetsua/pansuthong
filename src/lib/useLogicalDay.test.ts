import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLogicalDay } from "./useLogicalDay";

describe("useLogicalDay", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("advances at midnight with the default day start", async () => {
    vi.setSystemTime(new Date(2026, 6, 30, 23, 59, 30));
    const { result } = renderHook(() => useLogicalDay(0));

    expect(result.current).toBe("2026-07-30");

    await act(async () => { await vi.advanceTimersByTimeAsync(30_001); });

    expect(result.current).toBe("2026-07-31");
  });

  it("advances at the configured day-start hour", async () => {
    vi.setSystemTime(new Date(2026, 6, 30, 3, 59, 30));
    const { result } = renderHook(() => useLogicalDay(4));

    expect(result.current).toBe("2026-07-29");

    await act(async () => { await vi.advanceTimersByTimeAsync(30_001); });

    expect(result.current).toBe("2026-07-30");
  });

  it("re-syncs on window focus after the boundary passed with timers suspended", async () => {
    vi.setSystemTime(new Date(2026, 6, 30, 23, 0, 0));
    const { result } = renderHook(() => useLogicalDay(0));
    expect(result.current).toBe("2026-07-30");

    vi.setSystemTime(new Date(2026, 6, 31, 9, 0, 0));
    await act(async () => { window.dispatchEvent(new Event("focus")); });

    expect(result.current).toBe("2026-07-31");
  });

  it("does not re-render when a capped wake-up stays within the same logical day", async () => {
    vi.setSystemTime(new Date(2026, 6, 30, 12, 0, 0));
    const { result } = renderHook(() => useLogicalDay(0));
    const before = result.current;

    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });

    expect(result.current).toBe(before);
  });
});
