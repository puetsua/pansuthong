import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
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
  render(
    <MemoryRouter>
      <TagsView doc={d} indexes={buildIndexes(d)} />
    </MemoryRouter>,
  );
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

describe("TagsView — tag name links to its task list (#91)", () => {
  it("renders each tag name as a link to /tag/:id", () => {
    renderView([tag({ id: "t_a", name: "work" })]);
    const link = screen.getByRole("link", { name: /work/i });
    expect(link.getAttribute("href")).toBe("/tag/t_a");
  });

  it("keeps the pin/edit/delete controls outside the link so they still fire", () => {
    renderView([tag({ id: "t_a", name: "work", pinned: false })]);

    // The row's controls are siblings of the link, not nested in it.
    const link = screen.getByRole("link", { name: /work/i });
    const pin = screen.getByRole("button", { name: /pin #work to sidebar/i });
    expect(link.contains(pin)).toBe(false);

    fireEvent.click(pin);
    return waitFor(() =>
      expect(api.updateTag).toHaveBeenCalledWith({ id: "t_a", pinned: true }),
    );
  });
});
