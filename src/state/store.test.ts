import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { Document } from "../lib/tauri";

// Capture reload listeners so tests can fire a reload, and mock the IPC
// document fetch so we drive load success/failure deterministically (#42).
let storeChangedCb: (() => void) | undefined;
let settingsChangedCb: (() => void) | undefined;
const unlistenFn = vi.fn();
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((event: string, cb: () => void) => {
    if (event === "store-changed") storeChangedCb = cb;
    if (event === "settings-changed") settingsChangedCb = cb;
    return Promise.resolve(unlistenFn);
  }),
}));
vi.mock("../lib/tauri", () => ({
  api: { getDocument: vi.fn(), tryOpenData: vi.fn(), openDefaultStore: vi.fn() },
}));

import { api } from "../lib/tauri";
import { useDocument } from "./store";

const getDocument = vi.mocked(api.getDocument);
const tryOpenData = vi.mocked(api.tryOpenData);
const openDefaultStore = vi.mocked(api.openDefaultStore);

function makeDoc(theme: "auto" | "light" | "dark" = "auto"): Document {
  return {
    version: 2,
    last_modified: undefined,
    settings: { theme, sort_order: "priority" },
    tags: [],
    tasks: [],
    template_tasks: [],
  };
}

/** Doc whose logical day rolls over at `hour` instead of midnight. */
function makeDocWithDayStart(hour: number): Document {
  const doc = makeDoc();
  return { ...doc, settings: { ...doc.settings, day_start_hour: hour } };
}

beforeEach(() => {
  storeChangedCb = undefined;
  settingsChangedCb = undefined;
  getDocument.mockReset();
  tryOpenData.mockReset();
  openDefaultStore.mockReset();
});

describe("useDocument", () => {
  it("loads the document on mount and builds indexes", async () => {
    const doc = makeDoc();
    getDocument.mockResolvedValue(doc);

    const { result } = renderHook(() => useDocument());

    await waitFor(() => expect(result.current.doc).toBe(doc));
    expect(result.current.error).toBeNull();
    expect(result.current.reloadError).toBeNull();
    expect(result.current.indexes).not.toBeNull();
  });

  it("reloads when a store-changed event fires", async () => {
    const doc1 = makeDoc("auto");
    const doc2 = makeDoc("dark");
    getDocument.mockResolvedValue(doc1);

    const { result } = renderHook(() => useDocument());
    await waitFor(() => expect(result.current.doc).toBe(doc1));

    getDocument.mockResolvedValue(doc2);
    await act(async () => { storeChangedCb?.(); });

    await waitFor(() => expect(result.current.doc).toBe(doc2));
  });

  it("reloads when a settings-changed event fires", async () => {
    const doc1 = makeDoc("auto");
    const doc2 = makeDoc("light");
    getDocument.mockResolvedValue(doc1);

    const { result } = renderHook(() => useDocument());
    await waitFor(() => expect(result.current.doc).toBe(doc1));

    getDocument.mockResolvedValue(doc2);
    await act(async () => { settingsChangedCb?.(); });

    await waitFor(() => expect(result.current.doc).toBe(doc2));
  });

  it("treats a failed first load as fatal (error set, no doc)", async () => {
    getDocument.mockRejectedValue("boom");

    const { result } = renderHook(() => useDocument());

    await waitFor(() => expect(result.current.error).toBe("boom"));
    expect(result.current.doc).toBeNull();
    expect(result.current.indexes).toBeNull();
  });

  it("degrades a later reload failure to a dismissible banner, keeping the last-good doc", async () => {
    const doc1 = makeDoc();
    getDocument.mockResolvedValue(doc1);

    const { result } = renderHook(() => useDocument());
    await waitFor(() => expect(result.current.doc).toBe(doc1));

    getDocument.mockRejectedValue("network down");
    await act(async () => { storeChangedCb?.(); });

    await waitFor(() => expect(result.current.reloadError).toBe("network down"));
    expect(result.current.doc).toBe(doc1); // last-good doc stays on screen
    expect(result.current.error).toBeNull(); // not fatal

    act(() => result.current.dismissReloadError());
    await waitFor(() => expect(result.current.reloadError).toBeNull());
  });
});

// The logical day used to be baked into the indexes when they were built, so nothing
// re-derived it while the app sat idle: the Today view kept showing yesterday's list
// after the day-start hour passed, until some unrelated mutation rebuilt the indexes
// (#148).
describe("useDocument day rollover", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  /** Mount and let the initial `getDocument` resolve, all inside `act`. */
  async function mountSettled() {
    const rendered = renderHook(() => useDocument());
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(rendered.result.current.indexes).not.toBeNull();
    return rendered;
  }

  it("advances indexes.todayIso when the clock crosses the day-start hour", async () => {
    vi.setSystemTime(new Date(2026, 6, 30, 3, 59, 30)); // 03:59:30, day starts at 04:00
    getDocument.mockResolvedValue(makeDocWithDayStart(4));

    const { result } = await mountSettled();
    expect(result.current.indexes?.todayIso).toBe("2026-07-29"); // still the previous logical day

    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); }); // now 04:00:30

    expect(result.current.indexes?.todayIso).toBe("2026-07-30");
  });

  it("advances indexes.todayIso across plain midnight (default day start)", async () => {
    vi.setSystemTime(new Date(2026, 6, 30, 23, 59, 30));
    getDocument.mockResolvedValue(makeDoc());

    const { result } = await mountSettled();
    expect(result.current.indexes?.todayIso).toBe("2026-07-30");

    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); }); // now 00:00:30

    expect(result.current.indexes?.todayIso).toBe("2026-07-31");
  });

  // Timers are throttled or suspended while the machine sleeps, so the interval alone
  // would leave a laptop opened in the morning showing the previous day.
  it("advances on resume when the boundary was crossed with timers suspended", async () => {
    vi.setSystemTime(new Date(2026, 6, 30, 23, 0, 0));
    getDocument.mockResolvedValue(makeDoc());

    const { result } = await mountSettled();
    expect(result.current.indexes?.todayIso).toBe("2026-07-30");

    // Jump the clock without running the pending interval, standing in for sleep.
    vi.setSystemTime(new Date(2026, 6, 31, 9, 0, 0));
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });

    expect(result.current.indexes?.todayIso).toBe("2026-07-31");
  });

  // The document loads a moment after the first render, so `day_start_hour` arrives
  // late. If the day were held in state and corrected by an effect, the first
  // committed frame would show the day computed with the default hour.
  it("uses the document's day-start hour on the first frame that has the document", async () => {
    vi.setSystemTime(new Date(2026, 6, 30, 2, 0, 0)); // 02:00, before a 4am start
    getDocument.mockResolvedValue(makeDocWithDayStart(4));

    const { result } = await mountSettled();

    expect(result.current.indexes?.todayIso).toBe("2026-07-29");
  });

  it("does not rebuild the indexes on a tick that stays within the same day", async () => {
    vi.setSystemTime(new Date(2026, 6, 30, 12, 0, 0));
    getDocument.mockResolvedValue(makeDoc());

    const { result } = await mountSettled();
    const before = result.current.indexes;

    await act(async () => { await vi.advanceTimersByTimeAsync(60_000 * 5); });

    expect(result.current.indexes).toBe(before); // same reference: no needless rebuild
  });
});

describe("useDocument cloud-folder pending retries", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("retries a missing data folder and exposes attempt count + countdown", async () => {
    getDocument.mockRejectedValue("not found: data folder not available yet");
    tryOpenData.mockResolvedValue(false);

    const { result } = renderHook(() => useDocument());
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    expect(result.current.waitingForData).toBe(true);
    expect(result.current.gaveUp).toBe(false);
    expect(result.current.retryCount).toBe(1);
    expect(result.current.nextRetryIn).toBe(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(tryOpenData).toHaveBeenCalled();
    expect(result.current.retryCount).toBe(2);
    expect(result.current.nextRetryIn).toBe(2);
  });

  it("gives up after the retry budget so the user can pick a fallback", async () => {
    getDocument.mockRejectedValue("not found: data folder not available yet");
    tryOpenData.mockResolvedValue(false);

    const { result } = renderHook(() => useDocument());
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.waitingForData).toBe(true);

    await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1000); });
    expect(result.current.gaveUp).toBe(true);
    expect(result.current.waitingForData).toBe(false);
  });
});
