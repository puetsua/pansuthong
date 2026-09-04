import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DashboardView } from "./DashboardView";
import { buildIndexes } from "../state/indexes";
import { Document, Tag } from "../lib/tauri";

vi.mock("../lib/tauri", async orig => {
  const actual = await orig<typeof import("../lib/tauri")>();
  return { ...actual, api: { updateTag: vi.fn().mockResolvedValue({}) } };
});

import { api } from "../lib/tauri";

const tag = (over: Partial<Tag> & Pick<Tag, "id" | "name">): Tag => ({
  color: "#000",
  priority: 0,
  ...over,
});

const doc = (tags: Tag[]): Document => ({
  version: 2,
  settings: { theme: "auto", sort_order: "priority" },
  tags,
  tasks: [],
  template_tasks: [],
});

const renderView = (tags: Tag[]) => {
  const d = doc(tags);
  return render(<DashboardView doc={d} indexes={buildIndexes(d)} />);
};

describe("DashboardView — tag order", () => {
  beforeEach(() => {
    vi.mocked(api.updateTag).mockClear();
  });

  it("renders pinned tags in dashboard_order with name fallback", () => {
    renderView([
      tag({ id: "t1", name: "work", dashboard_view: "heatmap", dashboard_order: 1 }),
      tag({ id: "t2", name: "home", dashboard_view: "heatmap", dashboard_order: 0 }),
      tag({ id: "t3", name: "alpha", dashboard_view: "heatmap" }),
    ]);
    const cards = document.querySelectorAll(".dashboard-card-name");
    expect([...cards].map(el => el.textContent?.replace(/^#/, ""))).toEqual(["home", "work", "alpha"]);
  });

  it("persists a new order when move down is clicked", () => {
    renderView([
      tag({ id: "t1", name: "first", dashboard_view: "heatmap", dashboard_order: 0 }),
      tag({ id: "t2", name: "second", dashboard_view: "heatmap", dashboard_order: 1 }),
    ]);
    fireEvent.click(screen.getByRole("button", { name: /move first down/i }));
    expect(api.updateTag).toHaveBeenCalledWith({ id: "t2", dashboard_order: 0 });
    expect(api.updateTag).toHaveBeenCalledWith({ id: "t1", dashboard_order: 1 });
  });
});
