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

  it("reports the hovered element's token via onHover", () => {
    const onHover = vi.fn();
    const { container } = render(<ThemePreview tokens={{}} onHover={onHover} />);
    const accent = container.querySelector('[data-token="--c-accent"]') as HTMLElement;
    fireEvent.mouseEnter(accent);
    expect(onHover).toHaveBeenCalledWith("--c-accent");
    fireEvent.mouseLeave(accent);
    expect(onHover).toHaveBeenLastCalledWith(null);
  });
});
