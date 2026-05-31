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
  id: "k_1", title: "Write report", done: false,
  notes: "", tag_ids: [], created_at: 0, updated_at: 0,
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
  // done-checkbox. Restoring always clears `done`, which un-archives the task via
  // the done↔archived coupling — so it works even for legacy tasks that were
  // archived while still incomplete.
  it("shows a Restore button instead of a checkbox", () => {
    render(<TaskRow task={{ ...baseTask, done: true, archived: true }} tags={tags} todayIso="2026-05-31" archived />);
    expect(screen.getByRole("button", { name: /restore/i })).toBeTruthy();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("restores a completed archived task by clearing done", async () => {
    render(<TaskRow task={{ ...baseTask, done: true, archived: true }} tags={tags} todayIso="2026-05-31" archived />);
    fireEvent.click(screen.getByRole("button", { name: /restore/i }));
    await waitFor(() => expect(api.setTaskDone).toHaveBeenCalledWith("k_1", false));
  });

  it("restores a legacy archived-but-incomplete task (done already false)", async () => {
    render(<TaskRow task={{ ...baseTask, done: false, archived: true }} tags={tags} todayIso="2026-05-31" archived />);
    fireEvent.click(screen.getByRole("button", { name: /restore/i }));
    await waitFor(() => expect(api.setTaskDone).toHaveBeenCalledWith("k_1", false));
  });
});

describe("TaskRow template mode (#71)", () => {
  it("shows a 'New task' button instead of a checkbox", () => {
    render(<TaskRow task={{ ...baseTask, is_template: true }} tags={tags} todayIso="2026-05-31" template />);
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByRole("button", { name: /new task from/i })).toBeTruthy();
  });

  it("opens a pre-filled create editor (does not create the task instantly)", () => {
    render(
      <TaskRow task={{ ...baseTask, title: "Weekly report", is_template: true, due_offset_days: 3 }}
               tags={tags} todayIso="2026-05-31" template />,
    );
    fireEvent.click(screen.getByRole("button", { name: /new task from/i }));
    // Editor opens in create mode (dialog labelled "New task"), pre-filled from the
    // template — nothing is added until the user confirms with "Add task".
    expect(screen.getByRole("dialog", { name: /new task/i })).toBeTruthy();
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("Weekly report");
    expect(api.addTask).not.toHaveBeenCalled();
  });
});
