import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ThemeSettings } from "./ThemeSettings";
import type { Settings, ThemePreset } from "../lib/tauri";

function settings(over: Partial<Settings> = {}): Settings {
  return { theme: "auto", sort_order: "priority", ...over };
}

const mine: ThemePreset = { id: "custom_1", name: "Mine", light: {}, dark: {} };

describe("ThemeSettings", () => {
  it("sets the light/dark/auto mode", () => {
    const apply = vi.fn();
    render(<ThemeSettings settings={settings()} applySettings={apply} />);
    fireEvent.click(screen.getByRole("button", { name: "dark" }));
    expect(apply).toHaveBeenCalledWith({ theme: "dark" });
  });

  it("shows the current theme name for a built-in", () => {
    render(<ThemeSettings settings={settings({ theme_preset: "slate" })} applySettings={vi.fn()} />);
    expect(screen.getByText("Slate")).toBeTruthy();
  });

  it("shows the current theme name for a custom preset", () => {
    render(<ThemeSettings settings={settings({ theme_preset: "custom_1", custom_presets: [mine] })} applySettings={vi.fn()} />);
    expect(screen.getByText("Mine")).toBeTruthy();
  });

  it("opens the theme picker modal", () => {
    render(<ThemeSettings settings={settings()} applySettings={vi.fn()} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Choose theme" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});
