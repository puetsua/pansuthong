import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { ThemePickerModal } from "./ThemePickerModal";
import type { Settings, ThemePreset } from "../lib/tauri";

function settings(over: Partial<Settings> = {}): Settings {
  return { theme: "auto", sort_order: "priority", ...over };
}

const mine: ThemePreset = {
  id: "custom_1", name: "Mine",
  light: { "--c-accent": "#ff0000" }, dark: { "--c-accent": "#00ff00" },
};

describe("ThemePickerModal", () => {
  it("selects a built-in preset from its card", () => {
    const apply = vi.fn();
    render(<ThemePickerModal settings={settings()} applySettings={apply} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Slate" }));
    expect(apply).toHaveBeenCalledWith({ theme_preset: "slate" });
  });

  it("marks the active preset", () => {
    render(<ThemePickerModal settings={settings({ theme_preset: "slate" })} applySettings={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Slate" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("renders custom presets from settings", () => {
    render(<ThemePickerModal settings={settings({ custom_presets: [mine] })} applySettings={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Mine" })).toBeTruthy();
  });

  it("opens the editor when New theme is clicked", () => {
    render(<ThemePickerModal settings={settings()} applySettings={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "New theme" }));
    // two dialogs now (picker + editor); the editor carries the Name field
    expect(screen.getByLabelText("Name")).toBeTruthy();
  });

  it("saves a new theme from the editor and selects it", () => {
    const apply = vi.fn();
    render(<ThemePickerModal settings={settings()} applySettings={apply} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "New theme" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Custom A" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const patch = apply.mock.calls[0][0];
    expect(patch.custom_presets).toHaveLength(1);
    expect(patch.custom_presets[0].name).toBe("Custom A");
    expect(patch.theme_preset).toBe(patch.custom_presets[0].id);
  });

  it("deletes a custom preset from the editor after confirming", () => {
    const apply = vi.fn();
    render(<ThemePickerModal settings={settings({ theme_preset: "custom_1", custom_presets: [mine] })} applySettings={apply} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Mine" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" })); // footer trigger
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete" }));
    expect(apply).toHaveBeenCalledWith({ custom_presets: [], theme_preset: "default" });
  });

  it("offers edit and duplicate on a custom card, but not export or delete", () => {
    render(<ThemePickerModal settings={settings({ custom_presets: [mine] })} applySettings={vi.fn()} onClose={vi.fn()} />);
    const card = screen.getByRole("button", { name: "Mine" }).closest(".theme-card") as HTMLElement;
    expect(within(card).getByRole("button", { name: "Edit Mine" })).toBeTruthy();
    expect(within(card).getByRole("button", { name: "Duplicate Mine" })).toBeTruthy();
    expect(within(card).queryByRole("button", { name: "Export Mine" })).toBeNull();
    expect(within(card).queryByRole("button", { name: "Delete Mine" })).toBeNull();
  });

  it("previews only the active variant on cards", () => {
    render(<ThemePickerModal settings={settings({ theme: "dark" })} applySettings={vi.fn()} onClose={vi.fn()} />);
    const card = screen.getByRole("button", { name: "Slate" }).closest(".theme-card") as HTMLElement;
    const rows = card.querySelectorAll(".theme-palette-row");
    expect(rows).toHaveLength(1);
    expect(rows[0].getAttribute("data-variant")).toBe("dark");
  });

  it("closes via Done", () => {
    const onClose = vi.fn();
    render(<ThemePickerModal settings={settings()} applySettings={vi.fn()} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onClose).toHaveBeenCalled();
  });
});
