import { describe, it, expect } from "vitest";
import { Task, TimeEntry } from "./tauri";
import {
  runningEntry, isTiming, elapsedMs, formatClock, formatDurationShort, overlapsExisting,
  timingTasks, lastActivityMs, trackingStatus, mergeableEntry,
} from "./time";

const base: Task = {
  id: "k_1", title: "t", notes: "", tag_ids: [], created_at: "1970-01-01T00:00:00Z",
};
const at = (s: string) => Date.parse(s);
const withEntries = (entries: TimeEntry[]): Task => ({ ...base, time_entries: entries });

describe("runningEntry / isTiming (#81)", () => {
  it("finds the open interval (no end) and reports timing", () => {
    const open: TimeEntry = { id: "te_2", start: "2026-06-02T10:00:00+08:00" };
    const t = withEntries([{ id: "te_1", start: "2026-06-02T09:00:00+08:00", end: "2026-06-02T09:30:00+08:00" }, open]);
    expect(runningEntry(t)).toBe(open);
    expect(isTiming(t)).toBe(true);
  });

  it("returns undefined / false when nothing is open", () => {
    const t = withEntries([{ id: "te_1", start: "2026-06-02T09:00:00+08:00", end: "2026-06-02T09:30:00+08:00" }]);
    expect(runningEntry(t)).toBeUndefined();
    expect(isTiming(t)).toBe(false);
  });

  it("treats a task with no time_entries as not timing", () => {
    expect(isTiming(base)).toBe(false);
    expect(runningEntry(base)).toBeUndefined();
  });
});

describe("elapsedMs (#81)", () => {
  it("sums closed intervals", () => {
    const t = withEntries([
      { id: "a", start: "2026-06-02T09:00:00+08:00", end: "2026-06-02T09:30:00+08:00" }, // 30m
      { id: "b", start: "2026-06-02T10:00:00+08:00", end: "2026-06-02T10:15:00+08:00" }, // 15m
    ]);
    expect(elapsedMs(t, at("2026-06-02T12:00:00+08:00"))).toBe(45 * 60_000);
  });

  it("counts the open interval up to now", () => {
    const t = withEntries([{ id: "a", start: "2026-06-02T10:00:00+08:00" }]);
    expect(elapsedMs(t, at("2026-06-02T10:05:00+08:00"))).toBe(5 * 60_000);
  });

  it("clamps a backwards interval to zero rather than subtracting", () => {
    const t = withEntries([{ id: "a", start: "2026-06-02T10:00:00+08:00" }]);
    expect(elapsedMs(t, at("2026-06-02T09:00:00+08:00"))).toBe(0);
  });

  it("is zero for a task with no entries", () => {
    expect(elapsedMs(base, at("2026-06-02T10:00:00+08:00"))).toBe(0);
  });
});

describe("formatClock (#81)", () => {
  it("formats under an hour as M:SS", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(7_000)).toBe("0:07");
    expect(formatClock(83_000)).toBe("1:23");
  });
  it("formats an hour or more as H:MM:SS", () => {
    expect(formatClock(3_723_000)).toBe("1:02:03");
  });
});

describe("formatDurationShort (#81)", () => {
  it("shows seconds under a minute, minutes under an hour, then h+m", () => {
    expect(formatDurationShort(0)).toBe("0s");
    expect(formatDurationShort(45_000)).toBe("45s");
    expect(formatDurationShort(90_000)).toBe("1m");
    expect(formatDurationShort(3_600_000)).toBe("1h 0m");
    expect(formatDurationShort(5_025_000)).toBe("1h 23m");
  });
});

describe("timingTasks / lastActivityMs (#idle-timer)", () => {
  const closedA = withEntries([{ id: "a", start: "2026-06-02T09:00:00+08:00", end: "2026-06-02T10:00:00+08:00" }]);
  const closedB = { ...base, id: "k_2", time_entries: [{ id: "b", start: "2026-06-02T11:00:00+08:00", end: "2026-06-02T11:30:00+08:00" }] };
  const running = { ...base, id: "k_3", time_entries: [{ id: "c", start: "2026-06-02T12:00:00+08:00" }] };

  it("collects only the tasks with an open interval", () => {
    expect(timingTasks([closedA, closedB, running]).map(t => t.id)).toEqual(["k_3"]);
    expect(timingTasks([closedA, closedB])).toEqual([]);
  });

  it("returns the most recent finished end across all tasks", () => {
    expect(lastActivityMs([closedA, closedB])).toBe(at("2026-06-02T11:30:00+08:00"));
  });

  it("ignores open intervals when finding the last activity", () => {
    // The running task has no end; the last *finished* activity is closedA's end.
    expect(lastActivityMs([closedA, running])).toBe(at("2026-06-02T10:00:00+08:00"));
  });

  it("is null when nothing has ever been tracked", () => {
    expect(lastActivityMs([base])).toBeNull();
  });
});

describe("trackingStatus (#idle-timer)", () => {
  const session = at("2026-06-02T08:00:00+08:00");
  const closed = withEntries([{ id: "a", start: "2026-06-02T09:00:00+08:00", end: "2026-06-02T10:00:00+08:00" }]);
  const running = { ...base, id: "k_3", time_entries: [{ id: "c", start: "2026-06-02T11:00:00+08:00" }] };
  const now = at("2026-06-02T12:00:00+08:00");

  it("reports running with the count and longest live elapsed", () => {
    const other = { ...base, id: "k_4", time_entries: [{ id: "d", start: "2026-06-02T11:30:00+08:00" }] };
    const s = trackingStatus([running, other, closed], now, session);
    expect(s).toEqual({ kind: "running", count: 2, longestMs: 60 * 60_000 }); // running since 11:00
  });

  it("counts idle from the last finished activity when newer than the session start", () => {
    const s = trackingStatus([closed], now, session);
    expect(s).toEqual({ kind: "idle", sinceMs: 2 * 60 * 60_000 }); // since 10:00
  });

  it("counts idle from the session start when it is newer (app just reopened)", () => {
    // Last activity ended yesterday; a fresh launch re-anchors idle to the session.
    const stale = withEntries([{ id: "a", start: "2026-06-01T09:00:00+08:00", end: "2026-06-01T10:00:00+08:00" }]);
    const s = trackingStatus([stale], now, at("2026-06-02T11:45:00+08:00"));
    expect(s).toEqual({ kind: "idle", sinceMs: 15 * 60_000 });
  });

  it("counts idle from the session start when nothing was ever tracked", () => {
    const s = trackingStatus([base], now, at("2026-06-02T11:50:00+08:00"));
    expect(s).toEqual({ kind: "idle", sinceMs: 10 * 60_000 });
  });
});

describe("mergeableEntry (#idle-timer)", () => {
  const e = (id: string, start: string, end?: string): TimeEntry => ({ id, start, end });
  const entries = [
    e("x", "2026-06-02T09:00:00+08:00", "2026-06-02T10:00:00+08:00"),
    e("y", "2026-06-02T12:00:00+08:00", "2026-06-02T13:00:00+08:00"),
  ];
  const gap = 60_000;

  it("returns an entry whose end touches the candidate start", () => {
    const m = mergeableEntry(entries, at("2026-06-02T10:00:00+08:00"), at("2026-06-02T10:30:00+08:00"), gap);
    expect(m?.id).toBe("x");
  });

  it("returns an entry within the gap before the candidate", () => {
    // 30s after x's end — inside the 60s gap.
    const m = mergeableEntry(entries, at("2026-06-02T10:00:30+08:00"), at("2026-06-02T10:30:00+08:00"), gap);
    expect(m?.id).toBe("x");
  });

  it("returns undefined when the nearest entry is beyond the gap", () => {
    // Two minutes after x's end — outside the gap, and far from y.
    expect(mergeableEntry(entries, at("2026-06-02T10:02:00+08:00"), at("2026-06-02T10:30:00+08:00"), gap)).toBeUndefined();
  });

  it("picks the closest entry when several are near", () => {
    // Candidate sits just after x and well before y.
    const m = mergeableEntry(entries, at("2026-06-02T10:00:10+08:00"), at("2026-06-02T11:00:00+08:00"), gap);
    expect(m?.id).toBe("x");
  });

  it("ignores open entries as merge targets", () => {
    const open = [e("o", "2026-06-02T09:00:00+08:00")];
    expect(mergeableEntry(open, at("2026-06-02T09:30:00+08:00"), at("2026-06-02T09:45:00+08:00"), gap)).toBeUndefined();
  });
});

describe("overlapsExisting (#81)", () => {
  const e = (id: string, start: string, end?: string): TimeEntry => ({ id, start, end });
  const closed = [e("a", "2026-06-02T09:00:00+08:00", "2026-06-02T10:00:00+08:00")];

  it("flags a candidate that lands inside, straddles, or contains an entry", () => {
    expect(overlapsExisting(closed, at("2026-06-02T09:30:00+08:00"), at("2026-06-02T10:30:00+08:00"))).toBe(true);
    expect(overlapsExisting(closed, at("2026-06-02T08:30:00+08:00"), at("2026-06-02T09:30:00+08:00"))).toBe(true);
    expect(overlapsExisting(closed, at("2026-06-02T08:00:00+08:00"), at("2026-06-02T11:00:00+08:00"))).toBe(true);
  });

  it("allows back-to-back sessions that only touch at an endpoint", () => {
    expect(overlapsExisting(closed, at("2026-06-02T10:00:00+08:00"), at("2026-06-02T11:00:00+08:00"))).toBe(false);
    expect(overlapsExisting(closed, at("2026-06-02T08:00:00+08:00"), at("2026-06-02T09:00:00+08:00"))).toBe(false);
  });

  it("skips the entry being edited via exceptId", () => {
    expect(overlapsExisting(closed, at("2026-06-02T09:00:00+08:00"), at("2026-06-02T10:00:00+08:00"), "a")).toBe(false);
  });

  it("treats an open candidate or an open existing entry as extending to +infinity", () => {
    // Open candidate (running timer) starting inside the closed entry.
    expect(overlapsExisting(closed, at("2026-06-02T09:30:00+08:00"), null)).toBe(true);
    // Open existing entry: anything starting after its start clashes.
    const open = [e("b", "2026-06-02T12:00:00+08:00")];
    expect(overlapsExisting(open, at("2026-06-02T13:00:00+08:00"), at("2026-06-02T14:00:00+08:00"))).toBe(true);
    expect(overlapsExisting(open, at("2026-06-02T11:00:00+08:00"), at("2026-06-02T12:00:00+08:00"))).toBe(false);
  });

  it("never overlaps when the task has no entries", () => {
    expect(overlapsExisting(undefined, at("2026-06-02T09:00:00+08:00"), at("2026-06-02T10:00:00+08:00"))).toBe(false);
  });
});
