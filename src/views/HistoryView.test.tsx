import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { HistoryView } from "./HistoryView";
import { api, HistoryEntry } from "../lib/tauri";

vi.mock("../lib/tauri", async orig => {
  const actual = await orig<typeof import("../lib/tauri")>();
  return { ...actual, api: { ...actual.api, listHistory: vi.fn() } };
});

const historyEntry = (n: number, over: Partial<HistoryEntry> = {}): HistoryEntry => ({
  timestamp: `2026-06-${String(n).padStart(2, "0")}T10:00:00+08:00`,
  event: "task.updated",
  entity: "task",
  entity_id: `task_${n}`,
  title: `Task ${String(n).padStart(2, "0")}`,
  summary: "Updated task",
  ...over,
});

const listHistory = vi.mocked(api.listHistory);

const renderView = async (entries: HistoryEntry[]) => {
  listHistory.mockResolvedValue(entries);
  render(<HistoryView />);
  await screen.findByLabelText(/search history/i);
  await waitFor(() => expect(screen.queryByText(/loading history/i)).toBeNull());
};

const rowCount = () => screen.queryAllByRole("listitem").length;

describe("HistoryView — search + pagination", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows only the first page when there are more than 10 history entries", async () => {
    await renderView(Array.from({ length: 12 }, (_, i) => historyEntry(i + 1)));

    expect(rowCount()).toBe(10);
    expect(screen.getByText(/Page 1 of 2/i)).toBeTruthy();
  });

  it("advances to the next page", async () => {
    await renderView(Array.from({ length: 12 }, (_, i) => historyEntry(i + 1)));

    fireEvent.click(screen.getByRole("button", { name: /next page/i }));

    expect(rowCount()).toBe(2);
    expect(screen.getByText(/Page 2 of 2/i)).toBeTruthy();
  });

  it("changes the page size, collapsing to one page", async () => {
    await renderView(Array.from({ length: 12 }, (_, i) => historyEntry(i + 1)));

    fireEvent.change(screen.getByLabelText(/history entries per page/i), { target: { value: "30" } });

    expect(rowCount()).toBe(12);
    expect(screen.queryByText(/Page \d+ of/i)).toBeNull();
  });

  it("filters by title, summary, entity, event, or id", async () => {
    await renderView([
      historyEntry(1, { title: "Buy milk" }),
      historyEntry(2, { summary: "Deleted tag", entity: "tag", event: "tag.deleted", title: "#Errands" }),
      historyEntry(3, { entity_id: "special_note", title: "Read book" }),
    ]);

    fireEvent.change(screen.getByLabelText(/search history/i), { target: { value: "tag.deleted" } });
    expect(rowCount()).toBe(1);
    expect(screen.getByText("#Errands")).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/search history/i), { target: { value: "special" } });
    expect(rowCount()).toBe(1);
    expect(screen.getByText("Read book")).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/search history/i), { target: { value: "MILK" } });
    expect(rowCount()).toBe(1);
    expect(screen.getByText("Buy milk")).toBeTruthy();
  });

  it("resets to page 1 when a query narrows the results", async () => {
    await renderView(Array.from({ length: 12 }, (_, i) => historyEntry(i + 1, { title: `Item ${i + 1}` })));
    fireEvent.click(screen.getByRole("button", { name: /next page/i }));
    expect(screen.getByText(/Page 2 of 2/i)).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/search history/i), { target: { value: "Item 1" } });

    expect(rowCount()).toBe(4);
    expect(screen.getByText("Item 1")).toBeTruthy();
  });

  it("reports no matches for a query that hits nothing", async () => {
    await renderView([historyEntry(1, { title: "Buy milk" })]);

    fireEvent.change(screen.getByLabelText(/search history/i), { target: { value: "zzz" } });

    expect(rowCount()).toBe(0);
    expect(screen.getByText(/no history entries match/i)).toBeTruthy();
  });
});

describe("HistoryView — date-range filter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const setDate = (label: RegExp, value: string) =>
    fireEvent.change(screen.getByLabelText(label), { target: { value } });

  it("filters by history entry timestamp date", async () => {
    await renderView([
      historyEntry(1, { title: "Alpha", timestamp: "2026-04-15T12:00:00+08:00" }),
      historyEntry(2, { title: "Beta", timestamp: "2026-05-20T12:00:00+08:00" }),
      historyEntry(3, { title: "Gamma", timestamp: "2026-06-25T12:00:00+08:00" }),
    ]);

    setDate(/from date/i, "2026-05-01");
    setDate(/to date/i, "2026-12-31");

    expect(rowCount()).toBe(2);
    expect(screen.getByText("Beta")).toBeTruthy();
    expect(screen.getByText("Gamma")).toBeTruthy();
    expect(screen.queryByText("Alpha")).toBeNull();
  });

  it("combines the date range with text search", async () => {
    await renderView([
      historyEntry(1, { title: "Buy milk", timestamp: "2026-05-20T12:00:00+08:00" }),
      historyEntry(2, { title: "Buy eggs", timestamp: "2026-03-01T12:00:00+08:00" }),
    ]);

    setDate(/from date/i, "2026-05-01");
    setDate(/to date/i, "2026-12-31");
    fireEvent.change(screen.getByLabelText(/search history/i), { target: { value: "buy" } });

    expect(rowCount()).toBe(1);
    expect(screen.getByText("Buy milk")).toBeTruthy();
    expect(screen.queryByText("Buy eggs")).toBeNull();
  });

  it("constrains the pickers so To can't precede From", async () => {
    await renderView([historyEntry(1)]);

    setDate(/from date/i, "2026-05-01");
    setDate(/to date/i, "2026-06-01");

    expect(screen.getByLabelText(/from date/i).getAttribute("max")).toBe("2026-06-01");
    expect(screen.getByLabelText(/to date/i).getAttribute("min")).toBe("2026-05-01");
  });

  it("flags an invalid range where To is before From", async () => {
    await renderView([historyEntry(1)]);

    setDate(/from date/i, "2026-06-01");
    setDate(/to date/i, "2026-05-01");

    expect(screen.getByRole("alert")).toBeTruthy();
  });
});
