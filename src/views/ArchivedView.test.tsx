import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ArchivedView } from "./ArchivedView";
import { buildIndexes } from "../state/indexes";
import { Document, Task } from "../lib/tauri";

// Keep the real module (isDone/isArchived are used by the index builder and
// TaskRow); only stub the api the rows touch on Restore.
vi.mock("../lib/tauri", async orig => {
  const actual = await orig<typeof import("../lib/tauri")>();
  return { ...actual, api: { setTaskDone: vi.fn().mockResolvedValue({}) } };
});

const archivedTask = (n: number, title?: string): Task => ({
  id: `t_${n}`,
  title: title ?? `Task ${String(n).padStart(2, "0")}`,
  notes: "",
  tag_ids: [],
  created_at: "2026-01-01T00:00:00+08:00",
  completed_at: "2026-05-01T00:00:00+08:00",
});

const doc = (tasks: Task[]): Document => ({
  version: 2,
  last_modified: undefined,
  settings: { theme: "auto", sort_order: "priority" },
  tags: [],
  tasks,
  template_tasks: [],
});

const renderView = (tasks: Task[]) => {
  const d = doc(tasks);
  render(<ArchivedView doc={d} indexes={buildIndexes(d)} />);
};

// Each archived row carries one "Restore <title>" button, so counting them
// counts the rows currently on the page.
const rowCount = () => screen.queryAllByRole("button", { name: /^Restore / }).length;

describe("ArchivedView — search + pagination (#92)", () => {
  it("shows only the first page (10) when there are more archived tasks", () => {
    renderView(Array.from({ length: 12 }, (_, i) => archivedTask(i + 1)));
    expect(rowCount()).toBe(10);
    expect(screen.getByText(/Page 1 of 2/i)).toBeTruthy();
  });

  it("advances to the next page", () => {
    renderView(Array.from({ length: 12 }, (_, i) => archivedTask(i + 1)));
    fireEvent.click(screen.getByRole("button", { name: /next page/i }));
    expect(rowCount()).toBe(2);
    expect(screen.getByText(/Page 2 of 2/i)).toBeTruthy();
  });

  it("changes the page size, collapsing to a single page", () => {
    renderView(Array.from({ length: 12 }, (_, i) => archivedTask(i + 1)));
    fireEvent.change(screen.getByLabelText(/tasks per page/i), { target: { value: "30" } });
    expect(rowCount()).toBe(12);
    // One page now — no pager.
    expect(screen.queryByText(/Page \d+ of/i)).toBeNull();
  });

  it("filters by a case-insensitive substring of title or notes", () => {
    renderView([
      archivedTask(1, "Buy milk"),
      archivedTask(2, "Call dentist"),
      { ...archivedTask(3, "Read book"), notes: "about MILK production" },
    ]);
    fireEvent.change(screen.getByLabelText(/search archived/i), { target: { value: "milk" } });
    expect(rowCount()).toBe(2);
    expect(screen.getByText("Buy milk")).toBeTruthy();
    expect(screen.getByText("Read book")).toBeTruthy();
    expect(screen.queryByText("Call dentist")).toBeNull();
  });

  it("resets to page 1 when a query narrows the results", () => {
    const tasks = Array.from({ length: 12 }, (_, i) => archivedTask(i + 1, `Item ${i + 1}`));
    renderView(tasks);
    fireEvent.click(screen.getByRole("button", { name: /next page/i }));
    expect(screen.getByText(/Page 2 of 2/i)).toBeTruthy();
    // "Item 1" matches Item 1, 10, 11, 12 → 4 results, back on page 1.
    fireEvent.change(screen.getByLabelText(/search archived/i), { target: { value: "Item 1" } });
    expect(screen.getByText("Item 1")).toBeTruthy();
    expect(rowCount()).toBe(4);
  });

  it("reports no matches for a query that hits nothing", () => {
    renderView([archivedTask(1, "Buy milk")]);
    fireEvent.change(screen.getByLabelText(/search archived/i), { target: { value: "zzz" } });
    expect(rowCount()).toBe(0);
    expect(screen.getByText(/no archived tasks match/i)).toBeTruthy();
  });
});
