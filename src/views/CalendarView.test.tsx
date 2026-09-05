import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { CalendarView } from "./CalendarView";
import { buildIndexes } from "../state/indexes";
import { Document, Task } from "../lib/tauri";

vi.mock("../lib/viewport", () => ({ useIsMobile: () => false }));

function task(over: Partial<Task> & { id: string }): Task {
  return {
    title: over.title ?? over.id,
    notes: "",
    tag_ids: [],
    created_at: "2026-01-01T00:00:00+08:00",
    ...over,
  };
}

const doc: Document = {
  version: 2,
  settings: { theme: "auto", sort_order: "priority", first_day_of_week: 1 },
  tags: [],
  tasks: [
    task({ id: "k_a", title: "Buy cat litter", due_date: "2026-09-05" }),
    task({ id: "k_b", title: "Reply email", start_date: "2026-09-06" }),
  ],
  template_tasks: [],
};

describe("CalendarView", () => {
  it("defaults to month mode with task lines in cells", () => {
    const indexes = buildIndexes(doc, "2026-09-05");
    render(
      <MemoryRouter>
        <CalendarView doc={doc} indexes={indexes} />
      </MemoryRouter>,
    );

    expect(screen.getByRole("button", { name: "Month", pressed: true })).toBeTruthy();
    expect(screen.getByText("Buy cat litter")).toBeTruthy();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("switches to day mode when a date number is clicked", () => {
    const indexes = buildIndexes(doc, "2026-09-05");
    render(
      <MemoryRouter>
        <CalendarView doc={doc} indexes={indexes} />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: /Sep 6, 2026/i }));
    expect(screen.getByRole("button", { name: "Day", pressed: true })).toBeTruthy();
    expect(screen.getByText("Reply email")).toBeTruthy();
  });

  it("shows week columns in week mode", () => {
    const indexes = buildIndexes(doc, "2026-09-05");
    render(
      <MemoryRouter>
        <CalendarView doc={doc} indexes={indexes} />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Week" }));
    expect(screen.getByRole("grid", { name: /week calendar/i })).toBeTruthy();
    expect(screen.getByText("Reply email")).toBeTruthy();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("shows checkboxes without timers in day mode", () => {
    const indexes = buildIndexes(doc, "2026-09-05");
    render(
      <MemoryRouter>
        <CalendarView doc={doc} indexes={indexes} />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Day" }));
    expect(screen.getAllByRole("checkbox").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /start timer/i })).toBeNull();
  });

  it("keeps week view aligned after month navigation", () => {
    const indexes = buildIndexes(doc, "2026-09-05");
    render(
      <MemoryRouter>
        <CalendarView doc={doc} indexes={indexes} />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByLabelText("Next month"));
    fireEvent.click(screen.getByRole("button", { name: "Week" }));

    // Oct 5 week (Mon Oct 5 – Sun Oct 11) — not September's week.
    expect(screen.getByText(/Oct 5, 2026/i)).toBeTruthy();
    expect(screen.queryByText(/Sep 5, 2026/i)).toBeNull();
  });

  it("keeps month view aligned after week navigation", () => {
    const indexes = buildIndexes(doc, "2026-09-05");
    render(
      <MemoryRouter>
        <CalendarView doc={doc} indexes={indexes} />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Week" }));
    for (let i = 0; i < 4; i++) fireEvent.click(screen.getByLabelText("Next week"));
    fireEvent.click(screen.getByRole("button", { name: "Month" }));

    expect(screen.getByText("Oct 2026")).toBeTruthy();
    expect(screen.queryByText("Sep 2026")).toBeNull();
  });
});
