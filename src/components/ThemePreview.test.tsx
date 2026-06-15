import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { ThemePreview } from "./ThemePreview";

describe("ThemePreview", () => {
  it("applies the given tokens as inline CSS variables on its root", () => {
    const { container } = render(
      <ThemePreview tokens={{ "--c-bg": "#102030", "--c-accent": "#ff0000" }} />,
    );
    const root = container.querySelector(".theme-preview") as HTMLElement;
    expect(root.style.getPropertyValue("--c-bg")).toBe("#102030");
    expect(root.style.getPropertyValue("--c-accent")).toBe("#ff0000");
  });

  it("ignores tokens outside the known set", () => {
    const { container } = render(<ThemePreview tokens={{ "--c-evil": "#000000" }} />);
    const root = container.querySelector(".theme-preview") as HTMLElement;
    expect(root.style.getPropertyValue("--c-evil")).toBe("");
  });

  it("maps the delete text to the danger token", () => {
    const onHover = vi.fn();
    const { container } = render(<ThemePreview tokens={{}} onHover={onHover} />);
    const del = container.querySelector('[data-token="--c-danger"]') as HTMLElement;
    expect(del.textContent).toBe("Delete");
    fireEvent.mouseOver(del);
    expect(onHover).toHaveBeenLastCalledWith("--c-danger");
  });

  it("renders a sidebar with nav items", () => {
    const { container } = render(<ThemePreview tokens={{}} />);
    expect(container.querySelector(".theme-preview-sidebar")).toBeTruthy();
    expect(container.querySelectorAll(".tp-nav").length).toBeGreaterThanOrEqual(3);
  });

  it("reports the hovered element's token via onHover", () => {
    const onHover = vi.fn();
    const { container } = render(<ThemePreview tokens={{}} onHover={onHover} />);
    const root = container.querySelector(".theme-preview") as HTMLElement;
    const accent = container.querySelector('[data-token="--c-accent"]') as HTMLElement;
    fireEvent.mouseOver(accent);
    expect(onHover).toHaveBeenLastCalledWith("--c-accent");
    // moving onto the bare background area resolves to --c-bg, not nothing
    fireEvent.mouseOver(root);
    expect(onHover).toHaveBeenLastCalledWith("--c-bg");
    fireEvent.mouseLeave(root);
    expect(onHover).toHaveBeenLastCalledWith(null);
  });
});
