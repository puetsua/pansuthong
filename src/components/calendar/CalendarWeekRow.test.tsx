import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { CalendarWeekRow } from "./CalendarWeekRow";
import type { Row } from "../../state/indexes";

vi.mock("../TaskEditor", () => ({
  TaskEditor: () => null,
}));

const tags = new Map([
  ["t_work", { id: "t_work", name: "Work", color: "#336699", priority: 1 }],
]);

describe("CalendarWeekRow", () => {
  it("does not show a Recurring label on ghost rows", () => {
    const row: Row = {
      kind: "ghost",
      ghost: {
        id: "ghost_t1_2026-09-05",
        title: "Morning stretch",
        notes: "",
        tag_ids: ["t_work"],
        templateId: "t1",
        occurrenceDate: "2026-09-05",
      },
    };
    render(<CalendarWeekRow row={row} tags={tags} todayIso="2026-09-05" settings={{ theme: "auto" }} />);
    expect(screen.queryByText(/recurring/i)).toBeNull();
    expect(screen.queryByText(/週期/i)).toBeNull();
    expect(screen.getByText("Work")).toBeTruthy();
  });

  it("renders standard task-tag pills for tasks and ghosts", () => {
    const row: Row = {
      kind: "task",
      task: {
        id: "k1",
        title: "Reply email",
        notes: "",
        tag_ids: ["t_work"],
        created_at: "2026-01-01T00:00:00+08:00",
        due_date: "2026-09-05",
      },
    };
    const { container } = render(
      <CalendarWeekRow row={row} tags={tags} todayIso="2026-09-05" settings={{ theme: "auto" }} />,
    );
    const pill = container.querySelector(".task-tag");
    expect(pill).toBeTruthy();
    expect(pill?.classList.contains("task-tag")).toBe(true);
    expect(container.querySelector(".calendar-week-row-tags")).toBeNull();
  });
});
