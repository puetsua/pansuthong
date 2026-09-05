import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DashboardAddTagPopover } from "./DashboardAddTagPopover";
import { Tag } from "../lib/tauri";

const tag = (over: Partial<Tag> & Pick<Tag, "id" | "name">): Tag => ({
  color: "#f97316",
  priority: 0,
  ...over,
});

describe("DashboardAddTagPopover", () => {
  const onSelect = vi.fn();

  beforeEach(() => {
    onSelect.mockClear();
  });

  it("filters tags case-insensitively and selects on click", () => {
    const tags = [
      tag({ id: "t1", name: "Work" }),
      tag({ id: "t2", name: "home" }),
      tag({ id: "t3", name: "alpha" }),
    ];
    render(<DashboardAddTagPopover tags={tags} settings={{ theme: "dark" }} onSelect={onSelect} />);

    fireEvent.click(screen.getByRole("button", { name: /add tag/i }));
    fireEvent.change(screen.getByPlaceholderText(/search tags/i), { target: { value: "wo" } });

    expect(screen.getByRole("option", { name: /work/i })).toBeTruthy();
    expect(screen.queryByRole("option", { name: /alpha/i })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /^#?work$/i }));
    expect(onSelect).toHaveBeenCalledWith(tags[0]);
    expect(screen.getByRole("button", { name: /add tag/i }).getAttribute("aria-expanded")).toBe("false");
  });

  it("selects the highlighted row on Enter", () => {
    const tags = [tag({ id: "t1", name: "Work" }), tag({ id: "t2", name: "home" })];
    render(<DashboardAddTagPopover tags={tags} settings={{ theme: "dark" }} onSelect={onSelect} />);

    fireEvent.click(screen.getByRole("button", { name: /add tag/i }));
    const input = screen.getByPlaceholderText(/search tags/i);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onSelect).toHaveBeenCalledWith(tags[1]);
  });
});
