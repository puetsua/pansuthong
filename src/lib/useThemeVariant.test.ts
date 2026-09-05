import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { domThemeSetting, useThemeVariant } from "./useThemeVariant";

describe("domThemeSetting", () => {
  afterEach(() => {
    document.documentElement.removeAttribute("data-theme");
  });

  it("reads explicit light/dark from data-theme", () => {
    document.documentElement.setAttribute("data-theme", "light");
    expect(domThemeSetting()).toBe("light");
    document.documentElement.setAttribute("data-theme", "dark");
    expect(domThemeSetting()).toBe("dark");
  });

  it("falls back to auto when data-theme is absent", () => {
    document.documentElement.removeAttribute("data-theme");
    expect(domThemeSetting()).toBe("auto");
  });
});

describe("useThemeVariant", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute("data-theme");
  });

  afterEach(() => {
    document.documentElement.removeAttribute("data-theme");
  });

  it("prefers explicit settings over DOM data-theme", () => {
    document.documentElement.setAttribute("data-theme", "dark");
    const { result } = renderHook(() => useThemeVariant({ theme: "light" }));
    expect(result.current).toBe("light");
  });

  it("reacts when data-theme changes without a settings prop", async () => {
    document.documentElement.setAttribute("data-theme", "light");
    const { result } = renderHook(() => useThemeVariant());
    expect(result.current).toBe("light");

    act(() => {
      document.documentElement.setAttribute("data-theme", "dark");
    });

    await waitFor(() => {
      expect(result.current).toBe("dark");
    });
  });

  it("uses OS preference for auto when data-theme is absent", () => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    const { result } = renderHook(() => useThemeVariant({ theme: "auto" }));
    expect(result.current).toBe(mq?.matches ? "dark" : "light");
  });
});
