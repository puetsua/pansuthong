import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { TagView } from "./TagView";
import { buildIndexes } from "../state/indexes";
import { Document, Task } from "../lib/tauri";

const tagged = (over: Partial<Task>): Task => ({
  id: "k_task",
  title: "Tagged task",
  notes: "",
  tag_ids: ["t_work"],
  created_at: "2026-06-18T09:00:00+08:00",
  ...over,
});

const doc: Document = {
  version: 8,
  last_modified: undefined,
  settings: {
    theme: "auto",
    sort_order: "priority",
    recurrence_heatmap_days: 7,
    first_day_of_week: 1,
  },
  tags: [{ id: "t_work", name: "work", color: "#4338ca", priority: 0, pinned: true }],
  tasks: [
    tagged({
      id: "k_open",
      title: "Open work",
      time_entries: [{ id: "te_open", start: "2026-06-18T10:00:00+08:00", end: "2026-06-18T10:30:00+08:00" }],
    }),
    tagged({
      id: "k_done",
      title: "Finished work",
      completed_at: "2026-06-19T12:30:00+08:00",
      time_entries: [{ id: "te_done", start: "2026-06-19T11:00:00+08:00", end: "2026-06-19T12:00:00+08:00" }],
    }),
  ],
  template_tasks: [
    {
      id: "tmpl_daily",
      title: "Daily work",
      notes: "",
      tag_ids: ["t_work"],
      created_at: "2026-06-18T09:00:00+08:00",
      recurrence: { kind: "daily" },
      recurrence_tag_id: "t_work",
    },
  ],
};

function renderView() {
  render(
    <MemoryRouter initialEntries={["/tag/t_work"]}>
      <Routes>
        <Route path="/tag/:id" element={<TagView doc={doc} indexes={buildIndexes(doc)} />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("TagView tabs", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-24T12:00:00+08:00"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });
  it("defaults to the task list tab", () => {
    renderView();

    expect(screen.getByRole("tab", { name: "Task list" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("Open work")).toBeTruthy();
    expect(screen.queryByText("Finished work")).toBeNull();
  });

  it("shows tag heatmap statistics including completed and recurring tagged work", () => {
    renderView();

    fireEvent.click(screen.getByRole("tab", { name: "Statistic" }));

    expect(screen.getByText("1h 30m")).toBeTruthy();
    expect(screen.getByText("total spent")).toBeTruthy();
    expect(screen.getByText("7")).toBeTruthy();
    expect(screen.getByText("scheduled days")).toBeTruthy();
    expect(screen.getByText("completed streak")).toBeTruthy();
    expect(screen.getByText("completed tasks")).toBeTruthy();
    expect(screen.getByRole("table", { name: "Tag activity heatmap" })).toBeTruthy();
    expect(screen.getByText("Completed")).toBeTruthy();
    expect(screen.getByText("Opened")).toBeTruthy();
    expect(screen.getByText("No activity")).toBeTruthy();
    expect(screen.getByLabelText("2026/06/18: opened")).toBeTruthy();
    expect(screen.getByLabelText("2026/06/19: completed")).toBeTruthy();
  });
});
