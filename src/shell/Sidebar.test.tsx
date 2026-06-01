import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { buildIndexes } from "../state/indexes";
import { Document, Tag } from "../lib/tauri";

// SyncStatus (rendered inside the sidebar) touches the tauri api; stub it out.
vi.mock("../lib/tauri", () => ({ api: { syncNow: vi.fn() } }));

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

const renderSidebar = (tags: Tag[]) => {
  const d = doc(tags);
  render(
    <MemoryRouter>
      <Sidebar doc={d} indexes={buildIndexes(d)} />
    </MemoryRouter>,
  );
};

describe("Sidebar — tag curation (#78)", () => {
  it("lists only pinned tags, hiding the rest", () => {
    renderSidebar([
      tag({ id: "t_pin", name: "work", pinned: true }),
      tag({ id: "t_hidden", name: "someday", pinned: false }),
      tag({ id: "t_legacy", name: "legacy" }), // pinned absent => hidden
    ]);

    // The name renders plain; the colored "#" is a separate decorative glyph (#68).
    expect(screen.getByText("work")).toBeTruthy();
    expect(screen.queryByText("someday")).toBeNull();
    expect(screen.queryByText("legacy")).toBeNull();
  });

  it("shows a manage-tags hint when nothing is pinned", () => {
    renderSidebar([tag({ id: "t_a", name: "a" }), tag({ id: "t_b", name: "b" })]);

    expect(screen.getByText(/No pinned tags/i)).toBeTruthy();
    const manage = screen.getByRole("link", { name: /manage tags/i });
    expect(manage.getAttribute("href")).toBe("/tags");
  });
});
