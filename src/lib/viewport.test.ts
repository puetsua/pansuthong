import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDocumentShellAttribute } from "./viewport";

describe("useDocumentShellAttribute", () => {
  afterEach(() => {
    document.documentElement.removeAttribute("data-shell");
    vi.restoreAllMocks();
  });

  it("sets data-shell=desktop when the viewport is wide", () => {
    vi.spyOn(window, "matchMedia").mockImplementation(query => ({
      matches: query === "(max-width: 720px)" ? false : false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    renderHook(() => useDocumentShellAttribute());
    expect(document.documentElement.getAttribute("data-shell")).toBe("desktop");
  });

  it("removes data-shell on narrow (mobile) viewports", () => {
    vi.spyOn(window, "matchMedia").mockImplementation(query => ({
      matches: query === "(max-width: 720px)",
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    renderHook(() => useDocumentShellAttribute());
    expect(document.documentElement.hasAttribute("data-shell")).toBe(false);
  });
});
