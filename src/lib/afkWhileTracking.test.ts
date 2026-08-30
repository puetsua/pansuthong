import { describe, expect, it } from "vitest";
import { AFK_THRESHOLD_MS, afkSinceForStop, pollAfk } from "./afkWhileTracking";

const T = AFK_THRESHOLD_MS;
const NOW = 1_000_000;

describe("pollAfk (#170)", () => {
  it("clears AFK when nothing is running; preserves it when idle cannot be read", () => {
    expect(pollAfk(T + 1, NOW, T, false, 1)).toEqual({ afkSinceMs: null, prompt: false });
    expect(pollAfk(null, NOW, T, true, 1)).toEqual({ afkSinceMs: 1, prompt: false });
    expect(pollAfk(null, NOW, T, true, null)).toEqual({ afkSinceMs: null, prompt: false });
  });

  it("records AFK start at last input once idle crosses the threshold", () => {
    expect(pollAfk(T, NOW, T, true, null)).toEqual({ afkSinceMs: NOW - T, prompt: false });
    expect(pollAfk(T + 5_000, NOW, T, true, NOW - T)).toEqual({ afkSinceMs: NOW - T, prompt: false });
  });

  it("prompts when input resumes after AFK", () => {
    expect(pollAfk(0, NOW, T, true, NOW - T)).toEqual({ afkSinceMs: NOW - T, prompt: true });
    expect(pollAfk(T - 1, NOW, T, true, NOW - T)).toEqual({ afkSinceMs: NOW - T, prompt: true });
  });
});

describe("afkSinceForStop (#170)", () => {
  it("uses a remembered AFK start, else current or last idle over the threshold", () => {
    expect(afkSinceForStop(0, NOW, T, NOW - T, T)).toBe(NOW - T);
    expect(afkSinceForStop(T, NOW, T, null, null)).toBe(NOW - T);
    expect(afkSinceForStop(0, NOW, T, null, T + 1_000)).toBe(NOW - (T + 1_000));
    expect(afkSinceForStop(0, NOW, T, null, 10)).toBeNull();
    expect(afkSinceForStop(null, NOW, T, null, null)).toBeNull();
  });
});
