import { describe, expect, it } from "vitest";
import { addDaysIso, daysBetweenIso, formatIsoLocal } from "./dates";

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

  it("accepts an ISO-8601 UTC string (the stored/wire form)", () => {
    const out = formatIsoLocal("2026-06-01T12:34:56Z");
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
    // Same instant whether given as a string or its epoch-ms equivalent.
    expect(out).toBe(formatIsoLocal(Date.parse("2026-06-01T12:34:56Z")));
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
