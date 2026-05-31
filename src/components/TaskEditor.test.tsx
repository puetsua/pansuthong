import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Tag, Task } from "../lib/tauri";
import { TaskEditor } from "./TaskEditor";

vi.mock("../lib/tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/tauri")>();
  return {
    ...actual,
    api: {
      updateTask: vi.fn().mockResolvedValue({}),
      deleteTask: vi.fn().mockResolvedValue(undefined),
      setTaskArchived: vi.fn().mockResolvedValue({}),
      addTag: vi.fn((name: string, color: string) =>
        Promise.resolve({ id: `t_new_${name}`, name, color, priority: 0 })),
    },
  };
});

import { api } from "../lib/tauri";

const baseTask: Task = {
  id: "k_1", title: "Write report", done: false,
  notes: "", tag_ids: ["t_a"], created_at: 0, updated_at: 0,
};
const tags = new Map<string, Tag>([
  ["t_a", { id: "t_a", name: "work", color: "#06b6d4", priority: 5 }],
  ["t_b", { id: "t_b", name: "home", color: "#ef4444", priority: 1 }],
]);

const button = (name: RegExp | string) => screen.getByRole("button", { name }) as HTMLButtonElement;

beforeEach(() => vi.clearAllMocks());

describe("TaskEditor tags (#24)", () => {
  it("shows assigned tags as chips and only reveals candidates on focus", () => {
    render(<TaskEditor task={baseTask} allTags={tags} onClose={vi.fn()} />);

    // The assigned tag is shown as a removable chip...
    expect(screen.getByRole("button", { name: "Remove work" })).toBeTruthy();
    // ...and unassigned tags aren't listed until the input is focused.
    expect(screen.queryByRole("button", { name: "home" })).toBeNull();
    expect(screen.getByLabelText("Add tag")).toBeTruthy();
  });

  it("filters candidates and saves an existing tag picked from the dropdown", async () => {
    const onClose = vi.fn();
    render(<TaskEditor task={baseTask} allTags={tags} onClose={onClose} />);

    const input = screen.getByLabelText("Add tag");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "ho" } });
    fireEvent.click(button("home")); // pick the filtered candidate
    fireEvent.click(button("Save"));

    await waitFor(() =>
      expect(api.updateTask).toHaveBeenCalledWith(
        expect.objectContaining({ id: "k_1", tag_ids: ["t_a", "t_b"] }),
      ),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("creates a brand-new tag on Save and folds its id into the task", async () => {
    const onClose = vi.fn();
    render(<TaskEditor task={baseTask} allTags={tags} onClose={onClose} />);

    const input = screen.getByLabelText("Add tag");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "urgent" } });
    fireEvent.click(button(/create/i)); // the "Create “urgent”" row
    fireEvent.click(button("Save"));

    // The new tag is only created at Save time...
    await waitFor(() => expect(api.addTag).toHaveBeenCalledWith("urgent", expect.any(String)));
    // ...and its id is merged with the task's existing tags.
    await waitFor(() =>
      expect(api.updateTask).toHaveBeenCalledWith(
        expect.objectContaining({ id: "k_1", tag_ids: ["t_a", "t_new_urgent"] }),
      ),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});

describe("TaskEditor archive (#23)", () => {
  it("archives an active task", async () => {
    render(<TaskEditor task={baseTask} allTags={tags} onClose={vi.fn()} />);
    fireEvent.click(button("Archive"));
    await waitFor(() => expect(api.setTaskArchived).toHaveBeenCalledWith("k_1", true));
  });

  it("offers Unarchive for an archived task", async () => {
    render(<TaskEditor task={{ ...baseTask, archived: true }} allTags={tags} onClose={vi.fn()} />);
    fireEvent.click(button("Unarchive"));
    await waitFor(() => expect(api.setTaskArchived).toHaveBeenCalledWith("k_1", false));
  });
});

describe("TaskEditor date validation (#51)", () => {
  it("blocks Save when the due date precedes the scheduled date", () => {
    render(<TaskEditor task={baseTask} allTags={tags} onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Scheduled"), { target: { value: "2026-06-10" } });
    fireEvent.change(screen.getByLabelText("Due"), { target: { value: "2026-06-01" } });

    expect(screen.getByText(/can.?t be before the scheduled date/i)).toBeTruthy();
    expect(button("Save").disabled).toBe(true);
  });
});
