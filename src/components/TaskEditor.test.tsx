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
      addTask: vi.fn().mockResolvedValue({}),
      deleteTask: vi.fn().mockResolvedValue(undefined),
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
  // Archiving is now driven by completion (finishing a task archives it,
  // reopening restores it), so the modal no longer carries a manual archive
  // control — for active or already-archived tasks alike.
  it("has no Archive button on an active task", () => {
    render(<TaskEditor task={baseTask} allTags={tags} onClose={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Archive" })).toBeNull();
  });

  it("has no Unarchive button on an archived task", () => {
    render(<TaskEditor task={{ ...baseTask, archived: true }} allTags={tags} onClose={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Unarchive" })).toBeNull();
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

const backdrop = () => document.querySelector(".modal-backdrop") as HTMLElement;

describe("TaskEditor backdrop auto-save (#66)", () => {
  it("saves the edits and closes when the dirty form is valid", async () => {
    const onClose = vi.fn();
    render(<TaskEditor task={baseTask} allTags={tags} onClose={onClose} />);

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Edited title" } });
    fireEvent.click(backdrop());

    await waitFor(() =>
      expect(api.updateTask).toHaveBeenCalledWith(
        expect.objectContaining({ id: "k_1", title: "Edited title" }),
      ),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("keeps the modal open and shows the error when the title is empty", async () => {
    const onClose = vi.fn();
    render(<TaskEditor task={baseTask} allTags={tags} onClose={onClose} />);

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "" } });
    fireEvent.click(backdrop());

    expect(screen.getByText(/title can.?t be empty/i)).toBeTruthy();
    expect(api.updateTask).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes without saving when nothing changed", () => {
    const onClose = vi.fn();
    render(<TaskEditor task={baseTask} allTags={tags} onClose={onClose} />);

    fireEvent.click(backdrop());

    expect(api.updateTask).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});

const templateTask: Task = { ...baseTask, is_template: true, scheduled_offset_days: 0, due_offset_days: 2 };

describe("TaskEditor template editing (#71)", () => {
  it("a template shows relative-offset inputs instead of absolute date pickers", () => {
    render(<TaskEditor task={templateTask} allTags={tags} onClose={vi.fn()} />);
    expect(screen.queryByLabelText("Scheduled")).toBeNull();
    expect(screen.getByLabelText(/scheduled in \(days\)/i)).toBeTruthy();
    expect(screen.getByLabelText(/due in \(days\)/i)).toBeTruthy();
  });

  it("saves a template's offsets and clears absolute dates", async () => {
    const onClose = vi.fn();
    render(<TaskEditor task={templateTask} allTags={tags} onClose={onClose} />);

    fireEvent.change(screen.getByLabelText(/due in \(days\)/i), { target: { value: "5" } });
    fireEvent.click(button("Save"));

    await waitFor(() =>
      expect(api.updateTask).toHaveBeenCalledWith(
        expect.objectContaining({ id: "k_1", is_template: true, due_offset_days: 5, due_date: null }),
      ),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("blocks Save when a template's due offset precedes its scheduled offset (mirrors #51)", () => {
    render(<TaskEditor task={{ ...templateTask, scheduled_offset_days: 10, due_offset_days: 3 }}
                       allTags={tags} onClose={vi.fn()} />);
    expect(screen.getByText(/due offset can.?t be before/i)).toBeTruthy();
    expect(button("Save").disabled).toBe(true);
  });
});

describe("TaskEditor 'Save as template' option (#71)", () => {
  it("creates a template copy via the Options menu and keeps the task (no convert)", async () => {
    render(<TaskEditor task={baseTask} allTags={tags} onClose={vi.fn()} />);
    // There is no always-visible toggle — it lives behind the Options menu.
    expect(screen.queryByRole("checkbox", { name: /save as template/i })).toBeNull();

    fireEvent.click(button(/options/i));
    fireEvent.click(screen.getByRole("menuitem", { name: /save as template/i }));

    await waitFor(() =>
      expect(api.addTask).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Write report", is_template: true }),
      ),
    );
    // The original task is untouched — saving-as-template does not convert it.
    expect(api.updateTask).not.toHaveBeenCalled();
  });
});

describe("TaskEditor create mode (#71)", () => {
  it("adds a new task on save (no Delete, never updates)", async () => {
    const onClose = vi.fn();
    const draft: Task = { ...baseTask, id: "", title: "From template" };
    render(<TaskEditor task={draft} allTags={tags} creating onClose={onClose} />);

    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    fireEvent.click(button(/add task/i));

    await waitFor(() =>
      expect(api.addTask).toHaveBeenCalledWith(expect.objectContaining({ title: "From template" })),
    );
    expect(api.updateTask).not.toHaveBeenCalled();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});

describe("TaskEditor inert background (#43)", () => {
  it("marks #root inert + aria-hidden while open and clears it on close", () => {
    const root = document.createElement("div");
    root.id = "root";
    document.body.appendChild(root);
    try {
      const { unmount } = render(<TaskEditor task={baseTask} allTags={tags} onClose={vi.fn()} />);
      expect(root.hasAttribute("inert")).toBe(true);
      expect(root.getAttribute("aria-hidden")).toBe("true");

      unmount();
      expect(root.hasAttribute("inert")).toBe(false);
      expect(root.hasAttribute("aria-hidden")).toBe(false);
    } finally {
      root.remove();
    }
  });
});
