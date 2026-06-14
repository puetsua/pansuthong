import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ThemeSettings } from "./ThemeSettings";
import type { Settings } from "../lib/tauri";
import { getPreset } from "../lib/themes";

function settings(over: Partial<Settings> = {}): Settings {
  return { theme: "auto", sort_order: "priority", ...over };
}

describe("ThemeSettings", () => {
  it("renders the preset choices and marks the active one", () => {
    render(<ThemeSettings settings={settings({ theme_preset: "slate" })} applySettings={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Slate/ }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: /Sepia/ })).toBeTruthy();
  });

  it("selects a preset on click", () => {
    const apply = vi.fn();
    render(<ThemeSettings settings={settings()} applySettings={apply} />);
    fireEvent.click(screen.getByRole("button", { name: /Emerald/ }));
    expect(apply).toHaveBeenCalledWith({ theme_preset: "emerald" });
  });

  it("shows the resolved accent in the light editor and writes an override on change", () => {
    const apply = vi.fn();
    render(<ThemeSettings settings={settings()} applySettings={apply} />);
    const input = screen.getByLabelText("Light Accent") as HTMLInputElement;
    expect(input.value).toBe(getPreset("default").light["--c-accent"]);
    fireEvent.change(input, { target: { value: "#ff0000" } });
    expect(apply).toHaveBeenCalledWith({ theme_colors_light: { "--c-accent": "#ff0000" } });
  });

  it("merges a new override with existing ones for that variant", () => {
    const apply = vi.fn();
    render(<ThemeSettings settings={settings({ theme_colors_dark: { "--c-bg": "#010101" } })} applySettings={apply} />);
    fireEvent.change(screen.getByLabelText("Dark Accent"), { target: { value: "#222222" } });
    expect(apply).toHaveBeenCalledWith({ theme_colors_dark: { "--c-bg": "#010101", "--c-accent": "#222222" } });
  });

  it("resets a variant's overrides to the preset", () => {
    const apply = vi.fn();
    render(<ThemeSettings settings={settings({ theme_colors_light: { "--c-accent": "#ff0000" } })} applySettings={apply} />);
    fireEvent.click(screen.getByRole("button", { name: /Reset to preset Light/ }));
    expect(apply).toHaveBeenCalledWith({ theme_colors_light: {} });
  });
});
