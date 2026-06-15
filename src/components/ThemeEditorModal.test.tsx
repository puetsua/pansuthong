import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { ThemeEditorModal } from "./ThemeEditorModal";
import { getPreset, serializeThemeJson } from "../lib/themes";
import type { ThemePreset } from "../lib/tauri";

const base = getPreset("default");
function working(): ThemePreset {
  return { id: "custom_1", name: "Mine", light: { ...base.light }, dark: { ...base.dark } };
}

describe("ThemeEditorModal", () => {
  it("edits the light accent and saves the updated preset", () => {
    const onSave = vi.fn();
    render(<ThemeEditorModal preset={working()} onSave={onSave} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Accent"), { target: { value: "#ff0000" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0][0] as ThemePreset;
    expect(saved.id).toBe("custom_1");
    expect(saved.light["--c-accent"]).toBe("#ff0000");
    expect(saved.dark["--c-accent"]).toBe(base.dark["--c-accent"]); // untouched
  });

  it("edits the dark variant after switching tabs", () => {
    const onSave = vi.fn();
    render(<ThemeEditorModal preset={working()} onSave={onSave} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("tab", { name: "Dark" }));
    expect((screen.getByLabelText("Accent") as HTMLInputElement).value).toBe(base.dark["--c-accent"]);
    fireEvent.change(screen.getByLabelText("Accent"), { target: { value: "#00ff00" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect((onSave.mock.calls[0][0] as ThemePreset).dark["--c-accent"]).toBe("#00ff00");
  });

  it("renames and saves", () => {
    const onSave = vi.fn();
    render(<ThemeEditorModal preset={working()} onSave={onSave} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Renamed" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect((onSave.mock.calls[0][0] as ThemePreset).name).toBe("Renamed");
  });

  it("blocks saving an empty name", () => {
    const onSave = vi.fn();
    render(<ThemeEditorModal preset={{ ...working(), name: "" }} onSave={onSave} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).not.toHaveBeenCalled();
  });

  it("renders a live preview that reflects edits to the active tab", () => {
    render(<ThemeEditorModal preset={working()} onSave={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Accent"), { target: { value: "#ff0000" } });
    const preview = document.querySelector(".theme-preview") as HTMLElement;
    expect(preview.style.getPropertyValue("--c-accent")).toBe("#ff0000");
    expect(preview.style.getPropertyValue("--c-bg")).toBe(base.light["--c-bg"]);
  });

  it("highlights the matching token row when hovering the preview", () => {
    render(<ThemeEditorModal preset={working()} onSave={vi.fn()} onClose={vi.fn()} />);
    const accentInPreview = document.querySelector('.theme-preview [data-token="--c-accent"]') as HTMLElement;
    const row = (screen.getByLabelText("Accent").closest(".theme-token-row")) as HTMLElement;
    expect(row.className).not.toContain("is-highlighted");
    fireEvent.mouseEnter(accentInPreview);
    expect(row.className).toContain("is-highlighted");
    fireEvent.mouseLeave(accentInPreview);
    expect(row.className).not.toContain("is-highlighted");
  });

  it("exports the current theme as JSON reflecting edits", () => {
    render(<ThemeEditorModal preset={working()} onSave={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Accent"), { target: { value: "#abcdef" } });
    const ta = screen.getByLabelText("Theme JSON") as HTMLTextAreaElement;
    const parsed = JSON.parse(ta.value);
    expect(parsed.pansutong_theme).toBe(1);
    expect(parsed.name).toBe("Mine");
    expect(parsed.light["--c-accent"]).toBe("#abcdef");
  });

  it("imports a pasted theme into the editor fields", () => {
    render(<ThemeEditorModal preset={{ ...working(), name: "" }} onSave={vi.fn()} onClose={vi.fn()} />);
    const json = serializeThemeJson("Imported X", { "--c-accent": "#abcdef" }, {});
    fireEvent.change(screen.getByLabelText("Import"), { target: { value: json } });
    fireEvent.click(screen.getByRole("button", { name: "Override Theme" }));
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Imported X");
    expect((screen.getByLabelText("Accent") as HTMLInputElement).value).toBe("#abcdef");
  });

  it("shows an error for invalid import JSON", () => {
    render(<ThemeEditorModal preset={working()} onSave={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Import"), { target: { value: "nope" } });
    fireEvent.click(screen.getByRole("button", { name: "Override Theme" }));
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("opens on the dark tab when initialTab is dark", () => {
    render(<ThemeEditorModal preset={working()} initialTab="dark" onSave={vi.fn()} onClose={vi.fn()} />);
    expect((screen.getByLabelText("Accent") as HTMLInputElement).value).toBe(base.dark["--c-accent"]);
  });

  it("shows Delete only when onDelete is provided", () => {
    const { rerender } = render(<ThemeEditorModal preset={working()} onSave={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    rerender(<ThemeEditorModal preset={working()} onSave={vi.fn()} onClose={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Delete" })).toBeTruthy();
  });

  it("confirms before deleting via a dialog", () => {
    const onDelete = vi.fn();
    render(<ThemeEditorModal preset={working()} onSave={vi.fn()} onClose={vi.fn()} onDelete={onDelete} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete" })); // footer trigger
    const dlg = screen.getByRole("alertdialog");
    expect(onDelete).not.toHaveBeenCalled(); // not yet — awaiting confirmation
    fireEvent.click(within(dlg).getByRole("button", { name: "Delete" }));
    expect(onDelete).toHaveBeenCalled();
  });

  it("cancels deletion without calling onDelete", () => {
    const onDelete = vi.fn();
    render(<ThemeEditorModal preset={working()} onSave={vi.fn()} onClose={vi.fn()} onDelete={onDelete} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cancel" }));
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});
