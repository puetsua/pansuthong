import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { CalendarView } from "./CalendarView";
import { buildIndexes } from "../state/indexes";
import { Document, Task } from "../lib/tauri";

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
  it("renders the month grid and agenda for the selected day", () => {
    const indexes = buildIndexes(doc, "2026-09-05");
    render(
      <MemoryRouter>
        <CalendarView doc={doc} indexes={indexes} />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { level: 1, name: /calendar/i })).toBeTruthy();
    expect(screen.getByText("Buy cat litter")).toBeTruthy();

    const day6 = screen.getByRole("gridcell", { name: /Sep 6, 2026/i });
    fireEvent.click(day6);
    expect(screen.getByText("Reply email")).toBeTruthy();
  });

  it("jumps to today from the toolbar button", () => {
    const indexes = buildIndexes(doc, "2026-09-05");
    render(
      <MemoryRouter>
        <CalendarView doc={doc} indexes={indexes} />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByLabelText(/next month/i));
    fireEvent.click(screen.getByRole("button", { name: /^today$/i }));
    expect(screen.getByText("Buy cat litter")).toBeTruthy();
  });
});
