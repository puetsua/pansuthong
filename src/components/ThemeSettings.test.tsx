import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { ThemeSettings } from "./ThemeSettings";
import type { Settings, ThemePreset } from "../lib/tauri";
import { serializeThemeJson } from "../lib/themes";

function settings(over: Partial<Settings> = {}): Settings {
  return { theme: "auto", sort_order: "priority", ...over };
}

const mine: ThemePreset = {
  id: "custom_1", name: "Mine",
  light: { "--c-accent": "#ff0000" }, dark: { "--c-accent": "#00ff00" },
};

describe("ThemeSettings gallery", () => {
  it("selects a built-in preset from its card", () => {
    const apply = vi.fn();
    render(<ThemeSettings settings={settings()} applySettings={apply} />);
    fireEvent.click(screen.getByRole("button", { name: "Slate" }));
    expect(apply).toHaveBeenCalledWith({ theme_preset: "slate" });
  });

  it("marks the active preset", () => {
    render(<ThemeSettings settings={settings({ theme_preset: "slate" })} applySettings={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Slate" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("renders custom presets from settings", () => {
    render(<ThemeSettings settings={settings({ custom_presets: [mine] })} applySettings={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Mine" })).toBeTruthy();
  });

  it("opens the editor when New theme is clicked", () => {
    render(<ThemeSettings settings={settings()} applySettings={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "New theme" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("saves a new theme from the editor and selects it", () => {
    const apply = vi.fn();
    render(<ThemeSettings settings={settings()} applySettings={apply} />);
    fireEvent.click(screen.getByRole("button", { name: "New theme" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Custom A" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(apply).toHaveBeenCalledTimes(1);
    const patch = apply.mock.calls[0][0];
    expect(patch.custom_presets).toHaveLength(1);
    expect(patch.custom_presets[0].name).toBe("Custom A");
    expect(patch.theme_preset).toBe(patch.custom_presets[0].id);
  });

  it("deletes a custom preset", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const apply = vi.fn();
    render(<ThemeSettings settings={settings({ theme_preset: "custom_1", custom_presets: [mine] })} applySettings={apply} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete Mine" }));
    expect(apply).toHaveBeenCalledWith({ custom_presets: [], theme_preset: "default" });
  });

  it("imports a pasted theme as a new custom preset", () => {
    const apply = vi.fn();
    render(<ThemeSettings settings={settings()} applySettings={apply} />);
    const json = serializeThemeJson("Pasted", { "--c-accent": "#abcdef" }, {});
    fireEvent.change(screen.getByLabelText("Import a theme"), { target: { value: json } });
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    const patch = apply.mock.calls[0][0];
    expect(patch.custom_presets[0].name).toBe("Pasted");
    expect(patch.theme_preset).toBe(patch.custom_presets[0].id);
  });

  it("shows an error and imports nothing for invalid JSON", () => {
    const apply = vi.fn();
    render(<ThemeSettings settings={settings()} applySettings={apply} />);
    fireEvent.change(screen.getByLabelText("Import a theme"), { target: { value: "nonsense" } });
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    expect(apply).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("offers edit/duplicate/export/delete on a custom card", () => {
    render(<ThemeSettings settings={settings({ custom_presets: [mine] })} applySettings={vi.fn()} />);
    const card = screen.getByRole("button", { name: "Mine" }).closest(".theme-card") as HTMLElement;
    expect(within(card).getByRole("button", { name: "Edit Mine" })).toBeTruthy();
    expect(within(card).getByRole("button", { name: "Duplicate Mine" })).toBeTruthy();
    expect(within(card).getByRole("button", { name: "Export Mine" })).toBeTruthy();
    expect(within(card).getByRole("button", { name: "Delete Mine" })).toBeTruthy();
  });
});
