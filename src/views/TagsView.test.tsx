import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { TagsView } from "./TagsView";
import { buildIndexes } from "../state/indexes";
import { Document, Tag } from "../lib/tauri";

vi.mock("../lib/tauri", () => ({
  api: {
    updateTag: vi.fn().mockResolvedValue({}),
    deleteTag: vi.fn().mockResolvedValue(undefined),
  },
}));

import { api } from "../lib/tauri";

const tag = (over: Partial<Tag>): Tag => ({
  id: "t_x", name: "x", color: "#000", priority: 0, ...over,
});

const doc = (tags: Tag[]): Document => ({
  version: 2,
  last_modified: undefined,
  settings: { theme: "auto", sort_order: "priority" },
  tags,
  tasks: [],
  template_tasks: [],
});

const renderView = (tags: Tag[]) => {
  const d = doc(tags);
  render(<TagsView doc={d} indexes={buildIndexes(d)} />);
};

beforeEach(() => vi.clearAllMocks());

describe("TagsView — pin toggle (#78)", () => {
  it("pins an unpinned tag", async () => {
    renderView([tag({ id: "t_a", name: "work", pinned: false })]);

    fireEvent.click(screen.getByRole("button", { name: /pin #work to sidebar/i }));

    await waitFor(() =>
      expect(api.updateTag).toHaveBeenCalledWith({ id: "t_a", pinned: true }),
    );
  });

  it("unpins a pinned tag", async () => {
    renderView([tag({ id: "t_a", name: "work", pinned: true })]);

    fireEvent.click(screen.getByRole("button", { name: /unpin #work from sidebar/i }));

    await waitFor(() =>
      expect(api.updateTag).toHaveBeenCalledWith({ id: "t_a", pinned: false }),
    );
  });

  it("marks the pin control pressed for a pinned tag", () => {
    renderView([tag({ id: "t_a", name: "work", pinned: true })]);
    const btn = screen.getByRole("button", { name: /unpin #work from sidebar/i });
    expect(btn.getAttribute("aria-pressed")).toBe("true");
  });
});
