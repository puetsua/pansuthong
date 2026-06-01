import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Tag, TemplateTask } from "../lib/tauri";
import { TemplateRow } from "./TemplateRow";

vi.mock("../lib/tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/tauri")>();
  return {
    ...actual,
    api: {
      addTask: vi.fn().mockResolvedValue({}),
      updateTemplate: vi.fn().mockResolvedValue({}),
      deleteTemplate: vi.fn().mockResolvedValue({}),
    },
  };
});

import { api } from "../lib/tauri";

const baseTemplate: TemplateTask = {
  id: "k_1", title: "Weekly report",
  notes: "", tag_ids: [], created_at: "1970-01-01T00:00:00Z",
};
const tags = new Map<string, Tag>();

beforeEach(() => vi.clearAllMocks());

describe("TemplateRow (#71)", () => {
  it("shows a 'New task' button and no done-checkbox", () => {
    render(<TemplateRow template={baseTemplate} tags={tags} todayIso="2026-05-31" />);
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByRole("button", { name: /new task from/i })).toBeTruthy();
  });

  it("opens a pre-filled create editor (does not create the task instantly)", () => {
    render(
      <TemplateRow template={{ ...baseTemplate, due_offset_days: 3 }}
                   tags={tags} todayIso="2026-05-31" />,
    );
    fireEvent.click(screen.getByRole("button", { name: /new task from/i }));
    // Editor opens in create mode (dialog labelled "New task"), pre-filled from the
    // template — nothing is added until the user confirms with "Add task".
    expect(screen.getByRole("dialog", { name: /new task/i })).toBeTruthy();
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("Weekly report");
    expect(api.addTask).not.toHaveBeenCalled();
  });

  it("opens the template editor when the row body is clicked", () => {
    render(<TemplateRow template={baseTemplate} tags={tags} todayIso="2026-05-31" />);
    fireEvent.click(screen.getByRole("button", { name: /edit weekly report/i }));
    expect(screen.getByRole("dialog", { name: /edit template/i })).toBeTruthy();
  });
});
