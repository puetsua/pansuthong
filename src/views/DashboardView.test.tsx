import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DashboardView } from "./DashboardView";
import { buildIndexes } from "../state/indexes";
import { Document, Tag } from "../lib/tauri";

vi.mock("../lib/tauri", async orig => {
  const actual = await orig<typeof import("../lib/tauri")>();
  const stubTag = (id: string): Tag => ({ id, name: id, color: "#000", priority: 0 });
  return {
    ...actual,
    api: {
      ...actual.api,
      updateTag: vi.fn(async (input: { id: string }) => stubTag(input.id)),
    },
  };
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

function dataTransferWith(id: string) {
  const store: Record<string, string> = { "text/plain": id };
  return {
    effectAllowed: "move",
    setData: (format: string, value: string) => { store[format] = value; },
    getData: (format: string) => store[format] ?? "",
  };
}

function cardNames(): string[] {
  return [...document.querySelectorAll(".dashboard-card-name")]
    .map(el => el.textContent?.replace(/^#/, "") ?? "");
}

function dropReorder(fromId: string, fromName: string, ontoIndex: number) {
  const dataTransfer = dataTransferWith(fromId);
  fireEvent.dragStart(
    screen.getByRole("button", { name: new RegExp(`drag to reorder ${fromName}`, "i") }),
    { dataTransfer },
  );
  const cards = document.querySelectorAll(".dashboard-card");
  fireEvent.drop(cards[ontoIndex]!, { dataTransfer });
}

describe("DashboardView — tag order", () => {
  beforeEach(() => {
    vi.mocked(api.updateTag).mockClear();
    vi.mocked(api.updateTag).mockImplementation(async input =>
      tag({ id: input.id, name: input.id }),
    );
  });

  it("renders pinned tags in dashboard_order with name fallback", () => {
    renderView([
      tag({ id: "t1", name: "work", dashboard_view: "heatmap", dashboard_order: 1 }),
      tag({ id: "t2", name: "home", dashboard_view: "heatmap", dashboard_order: 0 }),
      tag({ id: "t3", name: "alpha", dashboard_view: "heatmap" }),
    ]);
    expect(cardNames()).toEqual(["home", "work", "alpha"]);
  });

  it("does not render move up/down reorder buttons", () => {
    renderView([
      tag({ id: "t1", name: "first", dashboard_view: "heatmap", dashboard_order: 0 }),
      tag({ id: "t2", name: "second", dashboard_view: "heatmap", dashboard_order: 1 }),
    ]);
    expect(screen.queryByRole("button", { name: /move .* (up|down)/i })).toBeNull();
    expect(screen.getAllByRole("button", { name: /drag to reorder/i })).toHaveLength(2);
  });

  it("persists reorder on drop using dataTransfer id", async () => {
    renderView([
      tag({ id: "t1", name: "first", dashboard_view: "heatmap", dashboard_order: 0 }),
      tag({ id: "t2", name: "second", dashboard_view: "heatmap", dashboard_order: 1 }),
    ]);
    dropReorder("t1", "first", 1);
    await waitFor(() => expect(api.updateTag).toHaveBeenCalledTimes(2));
    expect(api.updateTag).toHaveBeenCalledWith({ id: "t2", dashboard_order: 0 });
    expect(api.updateTag).toHaveBeenCalledWith({ id: "t1", dashboard_order: 1 });
  });

  it("awaits updateTag calls sequentially", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    vi.mocked(api.updateTag).mockImplementation(async (input): Promise<Tag> => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise(resolve => setTimeout(resolve, 5));
      inFlight -= 1;
      return tag({ id: input.id, name: input.id });
    });
    renderView([
      tag({ id: "t1", name: "first", dashboard_view: "heatmap", dashboard_order: 0 }),
      tag({ id: "t2", name: "second", dashboard_view: "heatmap", dashboard_order: 1 }),
    ]);
    dropReorder("t1", "first", 1);
    await waitFor(() => expect(api.updateTag).toHaveBeenCalledTimes(2));
    expect(maxInFlight).toBe(1);
  });

  it("shows persisted order after remount with updated document tags", async () => {
    const { unmount } = renderView([
      tag({ id: "t1", name: "first", dashboard_view: "heatmap", dashboard_order: 0 }),
      tag({ id: "t2", name: "second", dashboard_view: "heatmap", dashboard_order: 1 }),
    ]);
    dropReorder("t1", "first", 1);
    await waitFor(() => expect(api.updateTag).toHaveBeenCalledTimes(2));

    unmount();
    renderView([
      tag({ id: "t2", name: "second", dashboard_view: "heatmap", dashboard_order: 0 }),
      tag({ id: "t1", name: "first", dashboard_view: "heatmap", dashboard_order: 1 }),
    ]);
    expect(cardNames()).toEqual(["second", "first"]);
  });

  it("surfaces reorder failures", async () => {
    vi.mocked(api.updateTag).mockRejectedValueOnce("save failed");
    renderView([
      tag({ id: "t1", name: "first", dashboard_view: "heatmap", dashboard_order: 0 }),
      tag({ id: "t2", name: "second", dashboard_view: "heatmap", dashboard_order: 1 }),
    ]);
    dropReorder("t1", "first", 1);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("save failed");
    expect(cardNames()).toEqual(["first", "second"]);
  });
});
