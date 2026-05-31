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
  it("shows only assigned tags by default, hiding the rest behind Add tag", () => {
    render(<TaskEditor task={baseTask} allTags={tags} onClose={vi.fn()} />);

    // The assigned tag is shown as a removable chip...
    expect(screen.getByRole("button", { name: "Remove work" })).toBeTruthy();
    // ...and the unassigned tag is NOT rendered until the picker opens.
    expect(screen.queryByRole("button", { name: "home" })).toBeNull();
    expect(button(/add tag/i)).toBeTruthy();
  });

  it("reveals unassigned tags when Add tag is clicked, and saves the new selection", async () => {
    const onClose = vi.fn();
    render(<TaskEditor task={baseTask} allTags={tags} onClose={onClose} />);

    fireEvent.click(button(/add tag/i));
    fireEvent.click(button("home")); // add the previously-hidden tag
    fireEvent.click(button("Save"));

    await waitFor(() =>
      expect(api.updateTask).toHaveBeenCalledWith(
        expect.objectContaining({ id: "k_1", tag_ids: ["t_a", "t_b"] }),
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
