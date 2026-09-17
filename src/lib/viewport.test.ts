import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDocumentShellAttribute } from "./viewport";

function mockMatchMedia(matchesMobile: boolean): void {
  vi.spyOn(window, "matchMedia").mockImplementation(query => {
    const matches = query === "(max-width: 720px)" ? matchesMobile : false;
    const mql = {
      matches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    };
    return mql as MediaQueryList;
  });
}

describe("useDocumentShellAttribute", () => {
  afterEach(() => {
    document.documentElement.removeAttribute("data-shell");
    vi.restoreAllMocks();
  });

  it("sets data-shell=desktop when the viewport is wide", () => {
    mockMatchMedia(false);

    renderHook(() => useDocumentShellAttribute());
    expect(document.documentElement.getAttribute("data-shell")).toBe("desktop");
  });

  it("removes data-shell on narrow (mobile) viewports", () => {
    mockMatchMedia(true);

    renderHook(() => useDocumentShellAttribute());
    expect(document.documentElement.hasAttribute("data-shell")).toBe(false);
  });
});
