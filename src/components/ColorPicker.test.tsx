import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ColorPicker } from "./ColorPicker";

const swatches = () =>
  screen.getAllByRole("button").filter(b => b.className.includes("swatch"));

beforeEach(() => vi.clearAllMocks());

describe("ColorPicker", () => {
  it("offers a palette wider than the original eight swatches", () => {
    render(<ColorPicker value="#4338ca" onChange={vi.fn()} />);
    expect(swatches().length).toBeGreaterThan(8);
  });

  it("calls onChange with the swatch color when a swatch is clicked", () => {
    const onChange = vi.fn();
    render(<ColorPicker value="#4338ca" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Color #10b981" }));
    expect(onChange).toHaveBeenCalledWith("#10b981");
  });

  it("marks the swatch matching the current value as active", () => {
    render(<ColorPicker value="#10b981" onChange={vi.fn()} />);
    const active = screen.getByRole("button", { name: "Color #10b981" });
    expect(active.className).toContain("swatch-active");
    expect(active.getAttribute("aria-pressed")).toBe("true");
  });

  it("matches the active swatch case-insensitively", () => {
    render(<ColorPicker value="#10B981" onChange={vi.fn()} />);
    const active = screen.getByRole("button", { name: "Color #10b981" });
    expect(active.className).toContain("swatch-active");
  });

  it("exposes a native custom-color input seeded with the current value", () => {
    render(<ColorPicker value="#123456" onChange={vi.fn()} />);
    const custom = screen.getByLabelText("Custom color") as HTMLInputElement;
    expect(custom.type).toBe("color");
    expect(custom.value).toBe("#123456");
  });

  it("calls onChange when a custom color is entered", () => {
    const onChange = vi.fn();
    render(<ColorPicker value="#4338ca" onChange={onChange} />);
    const custom = screen.getByLabelText("Custom color");
    fireEvent.input(custom, { target: { value: "#abcdef" } });
    expect(onChange).toHaveBeenCalledWith("#abcdef");
  });

  it("falls back to a valid hex for the custom input when value is not a hex color", () => {
    render(<ColorPicker value="" onChange={vi.fn()} />);
    const custom = screen.getByLabelText("Custom color") as HTMLInputElement;
    expect(custom.value).toMatch(/^#[0-9a-f]{6}$/);
  });
});
