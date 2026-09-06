import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { EditableContextMenu } from "./EditableContextMenu";

vi.mock("../lib/platform", () => ({
  isMacOS: vi.fn().mockResolvedValue(false),
  modKeyLabel: (isMac: boolean) => (isMac ? "⌘" : "Ctrl"),
}));

describe("EditableContextMenu", () => {
  let root: HTMLDivElement;

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
    render(<EditableContextMenu />);
  });

  afterEach(() => {
    root.remove();
  });

  it("prevents the default menu on non-editable targets", () => {
    const prevented = vi.fn();
    root.addEventListener("contextmenu", () => prevented());

    fireEvent.contextMenu(root, { preventDefault: prevented });

    expect(prevented).toHaveBeenCalled();
    expect(screen.queryByRole("menuitem")).toBeNull();
  });

  it("opens Cut/Copy/Paste/Select all on editable targets with Ctrl shortcuts", () => {
    const input = document.createElement("input");
    input.value = "hello";
    input.setSelectionRange(0, 2);
    root.appendChild(input);

    fireEvent.contextMenu(input);

    expect(screen.getByRole("menuitem", { name: /cut/i })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /copy/i })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /paste/i })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /select all/i })).toBeTruthy();
    expect(screen.getByText("Ctrl+X")).toBeTruthy();
    expect(screen.getByText("Ctrl+C")).toBeTruthy();
  });

  it("closes on Escape", () => {
    const input = document.createElement("input");
    input.value = "x";
    root.appendChild(input);

    fireEvent.contextMenu(input);
    expect(screen.getByRole("menuitem", { name: /copy/i })).toBeTruthy();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menuitem")).toBeNull();
  });

  it("runs clipboard actions via execCommand", () => {
    const input = document.createElement("input");
    input.value = "hello";
    input.setSelectionRange(0, 5);
    root.appendChild(input);
    const exec = vi.spyOn(document, "execCommand").mockReturnValue(true);

    fireEvent.contextMenu(input);
    fireEvent.click(screen.getByRole("menuitem", { name: /copy/i }));

    expect(exec).toHaveBeenCalledWith("copy");
    expect(screen.queryByRole("menuitem")).toBeNull();

    exec.mockRestore();
  });
});
