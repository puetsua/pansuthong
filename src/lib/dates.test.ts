import { describe, expect, it } from "vitest";
import { formatIsoLocal } from "./dates";

describe("formatIsoLocal", () => {
  it("formats an epoch-ms timestamp as full ISO 8601 with seconds and a timezone offset", () => {
    const out = formatIsoLocal(1_748_589_722_000); // arbitrary instant
    // YYYY-MM-DDTHH:MM:SS±HH:MM (local zone), e.g. 2026-05-30T16:08:42+09:00
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
  });

  it("round-trips to the same instant (timezone-independent), truncated to seconds", () => {
    const ms = 1_748_589_722_123;
    const parsed = new Date(formatIsoLocal(ms)).getTime();
    expect(parsed).toBe(ms - (ms % 1000)); // second precision
  });

  it("renders an em dash for a missing/zero timestamp", () => {
    expect(formatIsoLocal(0)).toBe("—");
    expect(formatIsoLocal(undefined)).toBe("—");
  });
});
