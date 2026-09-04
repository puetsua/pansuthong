import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SearchView } from "./SearchView";
import { buildIndexes } from "../state/indexes";
import { Document, Tag, Task } from "../lib/tauri";
import { todayIso } from "../lib/dates";

vi.mock("../lib/tauri", async orig => {
  const actual = await orig<typeof import("../lib/tauri")>();
  return { ...actual, api: { setTaskDone: vi.fn().mockResolvedValue({}) } };
});

import { api } from "../lib/tauri";

const activeTask = (n: number, over: Partial<Task> = {}): Task => ({
  id: `t_${n}`,
  title: over.title ?? `Task ${String(n).padStart(2, "0")}`,
  notes: over.notes ?? "",
  tag_ids: over.tag_ids ?? [],
  created_at: "2026-01-01T00:00:00+08:00",
  ...over,
});

const archivedTask = (n: number, title?: string): Task => ({
  id: `a_${n}`,
  title: title ?? `Archived ${n}`,
  notes: "",
  tag_ids: [],
  created_at: "2026-01-01T00:00:00+08:00",
  completed_at: `${todayIso()}T12:00:00+08:00`,
});

const doc = (tasks: Task[], tags: Tag[] = []): Document => ({
  version: 2,
  last_modified: undefined,
  settings: { theme: "auto", sort_order: "priority" },
  tags,
  tasks,
  template_tasks: [],
});

const renderView = (tasks: Task[], tags: Tag[] = []) => {
  const d = doc(tasks, tags);
  return render(<SearchView doc={d} indexes={buildIndexes(d)} />);
};

const rowCount = () => screen.queryAllByRole("checkbox").length;

describe("SearchView — text search + pagination", () => {
  it("lists nothing until the user types a query", () => {
    renderView([activeTask(1, { title: "Buy milk" }), activeTask(2, { title: "Call dentist" })]);
    expect(rowCount()).toBe(0);
    expect(screen.getByText(/type to search active tasks/i)).toBeTruthy();
  });

  it("filters by a case-insensitive substring of title or notes", () => {
    renderView([
      activeTask(1, { title: "Buy milk" }),
      activeTask(2, { title: "Call dentist" }),
      activeTask(3, { title: "Read book", notes: "about MILK production" }),
    ]);
    fireEvent.change(screen.getByLabelText(/search active tasks/i), { target: { value: "milk" } });
    expect(rowCount()).toBe(2);
    expect(screen.getByText("Buy milk")).toBeTruthy();
    expect(screen.getByText("Read book")).toBeTruthy();
    expect(screen.queryByText("Call dentist")).toBeNull();
  });

  it("matches tasks by tag name", () => {
    const tags: Tag[] = [
      { id: "tg_work", name: "Work", color: "#000", priority: 1, pinned: true },
      { id: "tg_home", name: "Home", color: "#111", priority: 0, pinned: false },
    ];
    renderView([
      activeTask(1, { title: "Standup", tag_ids: ["tg_work"] }),
      activeTask(2, { title: "Laundry", tag_ids: ["tg_home"] }),
      activeTask(3, { title: "Untagged" }),
    ], tags);
    fireEvent.change(screen.getByLabelText(/search active tasks/i), { target: { value: "wor" } });
    expect(rowCount()).toBe(1);
    expect(screen.getByText("Standup")).toBeTruthy();
    expect(screen.queryByText("Laundry")).toBeNull();
  });

  it("excludes completed/archived tasks from results", () => {
    renderView([
      activeTask(1, { title: "Buy milk" }),
      archivedTask(2, "Buy milk later"),
    ]);
    fireEvent.change(screen.getByLabelText(/search active tasks/i), { target: { value: "milk" } });
    expect(rowCount()).toBe(1);
    expect(screen.getByText("Buy milk")).toBeTruthy();
    expect(screen.queryByText("Buy milk later")).toBeNull();
  });

  it("paginates large match sets and resets to page 1 on query change", () => {
    const tasks = Array.from({ length: 12 }, (_, i) => activeTask(i + 1, { title: `Item ${i + 1}` }));
    renderView(tasks);
    fireEvent.change(screen.getByLabelText(/search active tasks/i), { target: { value: "Item" } });
    expect(rowCount()).toBe(10);
    expect(screen.getByText(/Page 1 of 2/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /next page/i }));
    expect(rowCount()).toBe(2);
    expect(screen.getByText(/Page 2 of 2/i)).toBeTruthy();

    // "Item 1" matches Item 1, 10, 11, 12 → 4 results, back on page 1.
    fireEvent.change(screen.getByLabelText(/search active tasks/i), { target: { value: "Item 1" } });
    expect(screen.getByText("Item 1")).toBeTruthy();
    expect(rowCount()).toBe(4);
  });

  it("reports no matches for a query that hits nothing", () => {
    renderView([activeTask(1, { title: "Buy milk" })]);
    fireEvent.change(screen.getByLabelText(/search active tasks/i), { target: { value: "zzz" } });
    expect(rowCount()).toBe(0);
    expect(screen.getByText(/no active tasks match/i)).toBeTruthy();
  });
});

describe("SearchView — held completions (#185)", () => {
  it("drops held completions when the query is cleared", async () => {
    const tasks = [activeTask(1, { title: "Buy milk" })];
    const d = doc(tasks);
    const { rerender } = render(<SearchView doc={d} indexes={buildIndexes(d)} />);

    fireEvent.change(screen.getByLabelText(/search active tasks/i), { target: { value: "milk" } });
    expect(rowCount()).toBe(1);

    fireEvent.click(screen.getByRole("checkbox"));
    await waitFor(() => expect(api.setTaskDone).toHaveBeenCalled());
    const done = { ...tasks[0], completed_at: `${todayIso()}T12:00:00+08:00` };
    const d2 = doc([done]);
    rerender(<SearchView doc={d2} indexes={buildIndexes(d2)} />);
    await waitFor(() => expect(rowCount()).toBe(1));

    fireEvent.change(screen.getByLabelText(/search active tasks/i), { target: { value: "" } });
    expect(rowCount()).toBe(0);
    expect(screen.getByText(/type to search active tasks/i)).toBeTruthy();
  });

  it("drops held completions when the query no longer matches", async () => {
    const tasks = [activeTask(1, { title: "Buy milk" })];
    const d = doc(tasks);
    const { rerender } = render(<SearchView doc={d} indexes={buildIndexes(d)} />);

    fireEvent.change(screen.getByLabelText(/search active tasks/i), { target: { value: "milk" } });
    fireEvent.click(screen.getByRole("checkbox"));
    await waitFor(() => expect(api.setTaskDone).toHaveBeenCalled());
    const done = { ...tasks[0], completed_at: `${todayIso()}T12:00:00+08:00` };
    const d2 = doc([done]);
    rerender(<SearchView doc={d2} indexes={buildIndexes(d2)} />);
    await waitFor(() => expect(rowCount()).toBe(1));

    fireEvent.change(screen.getByLabelText(/search active tasks/i), { target: { value: "zzz" } });
    expect(rowCount()).toBe(0);
    expect(screen.getByText(/no active tasks match/i)).toBeTruthy();
  });
});
