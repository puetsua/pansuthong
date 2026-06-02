import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ArchivedView } from "./ArchivedView";
import { buildIndexes } from "../state/indexes";
import { Document, Task } from "../lib/tauri";
import { todayIso, addDaysIso } from "../lib/dates";

// Keep the real module (isDone/isArchived are used by the index builder and
// TaskRow); only stub the api the rows touch on Restore.
vi.mock("../lib/tauri", async orig => {
  const actual = await orig<typeof import("../lib/tauri")>();
  return { ...actual, api: { setTaskDone: vi.fn().mockResolvedValue({}) } };
});

// Completed "today" so these rows fall inside the default last-30-days window;
// the search/pagination tests below aren't about dates.
const archivedTask = (n: number, title?: string): Task => ({
  id: `t_${n}`,
  title: title ?? `Task ${String(n).padStart(2, "0")}`,
  notes: "",
  tag_ids: [],
  created_at: "2026-01-01T00:00:00+08:00",
  completed_at: `${todayIso()}T12:00:00+08:00`,
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

// A task with explicit dates for the date-range tests.
const dated = (over: Partial<Task>): Task => ({
  id: "t_d",
  title: "Dated",
  notes: "",
  tag_ids: [],
  created_at: "2026-01-01T00:00:00+08:00",
  completed_at: "2026-05-01T00:00:00+08:00",
  ...over,
});

const setDate = (label: RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("ArchivedView — date-range filter (#92)", () => {
  it("defaults to the last 30 days of completions on entry", () => {
    const today = todayIso();
    renderView([
      dated({ id: "r", title: "Recent", completed_at: `${addDaysIso(today, -5)}T12:00:00+08:00` }),
      dated({ id: "o", title: "Old", completed_at: `${addDaysIso(today, -60)}T12:00:00+08:00` }),
    ]);

    expect(rowCount()).toBe(1);
    expect(screen.getByText("Recent")).toBeTruthy();
    expect(screen.queryByText("Old")).toBeNull();
    // The inputs are pre-filled with the 30-day window.
    expect((screen.getByLabelText(/from date/i) as HTMLInputElement).value).toBe(addDaysIso(today, -30));
    expect((screen.getByLabelText(/to date/i) as HTMLInputElement).value).toBe(today);
  });

  it("filters by completion date (the default field)", () => {
    renderView([
      dated({ id: "a", title: "Alpha", completed_at: "2026-03-15T12:00:00+08:00" }),
      dated({ id: "b", title: "Beta", completed_at: "2026-05-20T12:00:00+08:00" }),
      dated({ id: "c", title: "Gamma", completed_at: "2026-06-25T12:00:00+08:00" }),
    ]);

    setDate(/from date/i, "2026-05-01");
    setDate(/to date/i, "2026-12-31");

    expect(rowCount()).toBe(2);
    expect(screen.getByText("Beta")).toBeTruthy();
    expect(screen.getByText("Gamma")).toBeTruthy();
    expect(screen.queryByText("Alpha")).toBeNull();
  });

  it("switches to due date, excluding tasks without one", () => {
    renderView([
      dated({ id: "a", title: "Alpha", due_date: "2026-04-01" }),
      dated({ id: "b", title: "Beta" }), // no due date
      dated({ id: "c", title: "Gamma", due_date: "2026-06-30" }),
    ]);

    fireEvent.change(screen.getByLabelText(/date field/i), { target: { value: "due" } });
    setDate(/from date/i, "2026-06-01");
    setDate(/to date/i, "2026-12-31");

    expect(rowCount()).toBe(1);
    expect(screen.getByText("Gamma")).toBeTruthy();
    expect(screen.queryByText("Beta")).toBeNull();
  });

  it("switches to created date", () => {
    renderView([
      dated({ id: "a", title: "Alpha", created_at: "2026-01-10T00:00:00+08:00" }),
      dated({ id: "b", title: "Beta", created_at: "2026-02-10T00:00:00+08:00" }),
      dated({ id: "c", title: "Gamma", created_at: "2026-03-10T00:00:00+08:00" }),
    ]);

    fireEvent.change(screen.getByLabelText(/date field/i), { target: { value: "created" } });
    setDate(/from date/i, "2026-01-01");
    setDate(/to date/i, "2026-02-28");

    expect(rowCount()).toBe(2);
    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.getByText("Beta")).toBeTruthy();
    expect(screen.queryByText("Gamma")).toBeNull();
  });

  it("combines the date range with the text search (AND)", () => {
    renderView([
      dated({ id: "a", title: "Buy milk", completed_at: "2026-05-20T12:00:00+08:00" }),
      dated({ id: "b", title: "Buy eggs", completed_at: "2026-03-01T12:00:00+08:00" }),
    ]);

    setDate(/from date/i, "2026-05-01");
    setDate(/to date/i, "2026-12-31");
    fireEvent.change(screen.getByLabelText(/search archived/i), { target: { value: "buy" } });

    expect(rowCount()).toBe(1);
    expect(screen.getByText("Buy milk")).toBeTruthy();
    expect(screen.queryByText("Buy eggs")).toBeNull();
  });

  it("constrains the pickers so To can't precede From (and vice versa)", () => {
    renderView([dated({})]);
    setDate(/from date/i, "2026-05-01");
    setDate(/to date/i, "2026-06-01");
    expect(screen.getByLabelText(/from date/i).getAttribute("max")).toBe("2026-06-01");
    expect(screen.getByLabelText(/to date/i).getAttribute("min")).toBe("2026-05-01");
  });

  it("flags an invalid range where To is before From", () => {
    renderView([dated({ completed_at: "2026-05-15T12:00:00+08:00" })]);
    setDate(/from date/i, "2026-06-01");
    setDate(/to date/i, "2026-05-01");
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("shows nothing once the date range is cleared and the search is empty", () => {
    const today = todayIso();
    renderView([
      dated({ id: "r", title: "Recent", completed_at: `${addDaysIso(today, -5)}T12:00:00+08:00` }),
      dated({ id: "o", title: "Old", completed_at: `${addDaysIso(today, -300)}T12:00:00+08:00` }),
    ]);

    expect(rowCount()).toBe(1); // default window hides the old one
    fireEvent.click(screen.getByRole("button", { name: /clear dates/i }));

    expect(rowCount()).toBe(0);
    expect(screen.getByText(/list archived tasks/i)).toBeTruthy();
  });

  it("brings tasks back when a search is typed after clearing the dates", () => {
    const today = todayIso();
    renderView([
      dated({ id: "r", title: "Recent", completed_at: `${addDaysIso(today, -5)}T12:00:00+08:00` }),
      dated({ id: "o", title: "Old apple", completed_at: `${addDaysIso(today, -300)}T12:00:00+08:00` }),
    ]);

    fireEvent.click(screen.getByRole("button", { name: /clear dates/i }));
    expect(rowCount()).toBe(0);

    fireEvent.change(screen.getByLabelText(/search archived/i), { target: { value: "apple" } });
    expect(rowCount()).toBe(1);
    expect(screen.getByText("Old apple")).toBeTruthy();
  });
});
