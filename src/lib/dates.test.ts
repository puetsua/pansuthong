import { describe, expect, it } from "vitest";
import { addDaysIso, daysBetweenIso, formatIsoLocal, todayIso } from "./dates";

describe("todayIso (day-start hour)", () => {
  it("returns the plain calendar date with the default (midnight) rollover", () => {
    expect(todayIso(new Date(2026, 5, 2, 3, 0, 0))).toBe("2026-06-02");
    expect(todayIso(new Date(2026, 5, 2, 3, 0, 0), 0)).toBe("2026-06-02");
  });

  it("counts the hours before the start hour as still the previous day", () => {
    // 03:00 with a 4am day start -> the day hasn't rolled over yet.
    expect(todayIso(new Date(2026, 5, 2, 3, 0, 0), 4)).toBe("2026-06-01");
    // 03:59 is the last minute of the previous logical day.
    expect(todayIso(new Date(2026, 5, 2, 3, 59, 0), 4)).toBe("2026-06-01");
  });

  it("rolls the day over exactly at the start hour", () => {
    expect(todayIso(new Date(2026, 5, 2, 4, 0, 0), 4)).toBe("2026-06-02");
    expect(todayIso(new Date(2026, 5, 2, 5, 30, 0), 4)).toBe("2026-06-02");
  });

  it("treats the rest of the day (up to midnight) as the same logical day", () => {
    expect(todayIso(new Date(2026, 5, 2, 23, 59, 0), 4)).toBe("2026-06-02");
  });
});

describe("addDaysIso / daysBetweenIso (#71)", () => {
  it("addDaysIso adds days across month boundaries", () => {
    expect(addDaysIso("2026-05-31", 0)).toBe("2026-05-31");
    expect(addDaysIso("2026-05-31", 3)).toBe("2026-06-03");
    expect(addDaysIso("2026-12-31", 1)).toBe("2027-01-01");
  });
  it("daysBetweenIso is the inverse and signed", () => {
    expect(daysBetweenIso("2026-05-31", "2026-06-03")).toBe(3);
    expect(daysBetweenIso("2026-05-31", "2026-05-31")).toBe(0);
    expect(daysBetweenIso("2026-06-03", "2026-05-31")).toBe(-3);
  });
});

describe("formatIsoLocal", () => {
  it("formats an epoch-ms timestamp as full ISO 8601 with seconds and a timezone offset", () => {
    const out = formatIsoLocal(1_748_589_722_000); // arbitrary instant
    // YYYY-MM-DDTHH:MM:SS±HH:MM (local zone), e.g. 2026-05-30T16:08:42+09:00
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
  });

  it("accepts an ISO-8601 string in any offset (local is the stored/wire form; UTC stays back-compatible)", () => {
    const out = formatIsoLocal("2026-06-01T12:34:56Z");
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
    // Same instant whether given as a UTC string, an offset string, or epoch ms.
    expect(out).toBe(formatIsoLocal(Date.parse("2026-06-01T12:34:56Z")));
    expect(out).toBe(formatIsoLocal("2026-06-01T20:34:56+08:00"));
  });

  it("round-trips to the same instant (timezone-independent), truncated to seconds", () => {
    const ms = 1_748_589_722_123;
    const parsed = new Date(formatIsoLocal(ms)).getTime();
    expect(parsed).toBe(ms - (ms % 1000)); // second precision
  });

  it("renders an em dash for a missing/empty/zero timestamp", () => {
    expect(formatIsoLocal(0)).toBe("—");
    expect(formatIsoLocal(undefined)).toBe("—");
    expect(formatIsoLocal(null)).toBe("—");
    expect(formatIsoLocal("")).toBe("—");
  });
});
