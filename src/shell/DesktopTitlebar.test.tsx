import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DesktopTitlebar } from "./DesktopTitlebar";

const startDragging = vi.fn().mockResolvedValue(undefined);
const toggleMaximize = vi.fn().mockResolvedValue(undefined);
const isMaximized = vi.fn().mockResolvedValue(false);
const setDecorations = vi.fn().mockResolvedValue(undefined);
const onResized = vi.fn().mockResolvedValue(() => {});

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    startDragging,
    toggleMaximize,
    isMaximized,
    setDecorations,
    onResized,
    minimize: vi.fn(),
    close: vi.fn(),
  }),
}));

vi.mock("../lib/platform", () => ({
  isLinux: vi.fn().mockResolvedValue(false),
}));

beforeEach(() => {
  startDragging.mockClear();
  toggleMaximize.mockClear();
});

describe("DesktopTitlebar", () => {
  it("does not use data-tauri-drag-region (manual drag path)", () => {
    const { container } = render(<DesktopTitlebar />);
    expect(container.querySelector("[data-tauri-drag-region]")).toBeNull();
  });

  it("starts dragging on mousedown in the drag region (non-Linux)", () => {
    render(<DesktopTitlebar />);
    const drag = document.querySelector(".desktop-titlebar-drag");
    expect(drag).not.toBeNull();
    fireEvent.mouseDown(drag!, { button: 0, detail: 1 });
    expect(startDragging).toHaveBeenCalledTimes(1);
  });

  it("toggles maximize on double mousedown in the drag region", () => {
    render(<DesktopTitlebar />);
    const drag = document.querySelector(".desktop-titlebar-drag");
    fireEvent.mouseDown(drag!, { button: 0, detail: 2 });
    expect(toggleMaximize).toHaveBeenCalledTimes(1);
    expect(startDragging).not.toHaveBeenCalled();
  });

  it("renders window control buttons", () => {
    render(<DesktopTitlebar />);
    expect(screen.getByLabelText(/minimize/i)).toBeTruthy();
    expect(screen.getByLabelText(/maximize|restore/i)).toBeTruthy();
    expect(screen.getByLabelText(/close/i)).toBeTruthy();
  });
});
