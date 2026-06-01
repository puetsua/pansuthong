import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Tag, Task } from "../lib/tauri";
import { TaskRow } from "./TaskRow";

vi.mock("../lib/tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/tauri")>();
  return {
    ...actual,
    api: {
      setTaskDone: vi.fn().mockResolvedValue({}),
      addTask: vi.fn().mockResolvedValue({}),
    },
  };
});

import { api } from "../lib/tauri";

const baseTask: Task = {
  id: "k_1", title: "Write report",
  notes: "", tag_ids: [], created_at: "1970-01-01T00:00:00Z",
};
const tags = new Map<string, Tag>();

beforeEach(() => vi.clearAllMocks());

describe("TaskRow active mode", () => {
  it("toggles done via the checkbox", async () => {
    render(<TaskRow task={baseTask} tags={tags} todayIso="2026-05-31" />);
    fireEvent.click(screen.getByRole("checkbox", { name: /toggle/i }));
    await waitFor(() => expect(api.setTaskDone).toHaveBeenCalledWith("k_1", true));
  });
});

describe("TaskRow archived mode (#23)", () => {
  // In the Archived view the row offers a single "Restore" action instead of a
  // done-checkbox. Restoring always clears completion, which un-archives the task
  // (completion and archival are the same `completed_at` state).
  const archivedTask: Task = { ...baseTask, completed_at: "2025-05-23T12:00:00Z" };

  it("shows a Restore button instead of a checkbox", () => {
    render(<TaskRow task={archivedTask} tags={tags} todayIso="2026-05-31" archived />);
    expect(screen.getByRole("button", { name: /restore/i })).toBeTruthy();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("restores an archived task by clearing completion", async () => {
    render(<TaskRow task={archivedTask} tags={tags} todayIso="2026-05-31" archived />);
    fireEvent.click(screen.getByRole("button", { name: /restore/i }));
    await waitFor(() => expect(api.setTaskDone).toHaveBeenCalledWith("k_1", false));
  });
});
