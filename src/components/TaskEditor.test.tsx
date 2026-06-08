import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Tag, Task, TemplateTask } from "../lib/tauri";
import { TaskEditor } from "./TaskEditor";

vi.mock("../lib/tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/tauri")>();
  return {
    ...actual,
    api: {
      updateTask: vi.fn().mockResolvedValue({}),
      addTask: vi.fn().mockResolvedValue({}),
      setTaskDone: vi.fn().mockResolvedValue({}),
      deleteTask: vi.fn().mockResolvedValue(undefined),
      addTemplate: vi.fn().mockResolvedValue({}),
      updateTemplate: vi.fn().mockResolvedValue({}),
      deleteTemplate: vi.fn().mockResolvedValue(undefined),
      addTag: vi.fn((name: string, color: string) =>
        Promise.resolve({ id: `t_new_${name}`, name, color, priority: 0 })),
    },
  };
});

import { api } from "../lib/tauri";

const baseTask: Task = {
  id: "k_1", title: "Write report",
  notes: "", tag_ids: ["t_a"], created_at: "1970-01-01T00:00:00Z",
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
    render(<TaskEditor task={{ ...baseTask, completed_at: "2026-05-28T10:00:00Z" }} allTags={tags} onClose={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Unarchive" })).toBeNull();
  });
});

describe("TaskEditor date validation (#51)", () => {
  it("blocks Save when the due date precedes the scheduled date", () => {
    render(<TaskEditor task={baseTask} allTags={tags} onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Start Date"), { target: { value: "2026-06-10" } });
    fireEvent.change(screen.getByLabelText("Due Date"), { target: { value: "2026-06-01" } });

    expect(screen.getByText(/can.?t be before the start date/i)).toBeTruthy();
    expect(button("Save").disabled).toBe(true);
  });
});

describe("TaskEditor time-of-day (#93)", () => {
  it("disables the time input until a date is set, then saves the time", async () => {
    render(<TaskEditor task={baseTask} allTags={tags} onClose={vi.fn()} />);

    const schedTime = screen.getByLabelText("Start time") as HTMLInputElement;
    expect(schedTime.disabled).toBe(true); // no date yet

    fireEvent.change(screen.getByLabelText("Start Date"), { target: { value: "2026-06-05" } });
    expect((screen.getByLabelText("Start time") as HTMLInputElement).disabled).toBe(false);
    fireEvent.change(screen.getByLabelText("Start time"), { target: { value: "09:30" } });
    fireEvent.click(button("Save"));

    await waitFor(() =>
      expect(api.updateTask).toHaveBeenCalledWith(
        expect.objectContaining({ start_date: "2026-06-05", start_time: "09:30" }),
      ),
    );
  });

  it("blocks Save when due precedes scheduled on the same day by time", () => {
    render(<TaskEditor task={baseTask} allTags={tags} onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Start Date"), { target: { value: "2026-06-05" } });
    fireEvent.change(screen.getByLabelText("Start time"), { target: { value: "14:00" } });
    fireEvent.change(screen.getByLabelText("Due Date"), { target: { value: "2026-06-05" } });
    fireEvent.change(screen.getByLabelText("Due time"), { target: { value: "09:00" } });

    expect(screen.getByText(/can.?t be before the start date/i)).toBeTruthy();
    expect(button("Save").disabled).toBe(true);
  });
});

describe("TaskEditor Markdown notes (#70)", () => {
  it("renders Markdown in the split preview by default", () => {
    const task: Task = {
      ...baseTask,
      notes: "Hello **bold**\n\n- first",
    };
    render(<TaskEditor task={task} allTags={tags} onClose={vi.fn()} />);

    const strong = screen.getByText("bold");
    expect(strong.tagName).toBe("STRONG");
    expect(screen.getByText("first").tagName).toBe("LI");
  });

  it("keeps saving the raw Markdown source in notes", async () => {
    render(<TaskEditor task={baseTask} allTags={tags} onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Markdown notes"), {
      target: { value: "Write **summary**" },
    });
    fireEvent.click(button("Save"));

    await waitFor(() =>
      expect(api.updateTask).toHaveBeenCalledWith(
        expect.objectContaining({ id: "k_1", notes: "Write **summary**" }),
      ),
    );
  });

  it("does not inject raw HTML from notes into the preview", () => {
    const task: Task = {
      ...baseTask,
      notes: '<img src="x" onerror="alert(1)" /> **safe**',
    };
    render(<TaskEditor task={task} allTags={tags} onClose={vi.fn()} />);

    expect(document.querySelector(".te-notes-preview img")).toBeNull();
    expect(screen.getByText("safe").tagName).toBe("STRONG");
  });
});

const backdrop = () => document.querySelector(".modal-backdrop") as HTMLElement;

describe("TaskEditor outside clicks", () => {
  it("does not save or close when clicking outside a dirty valid form", () => {
    const onClose = vi.fn();
    render(<TaskEditor task={baseTask} allTags={tags} onClose={onClose} />);

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Edited title" } });
    fireEvent.click(backdrop());

    expect(api.updateTask).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not validate or close when clicking outside an invalid dirty form", () => {
    const onClose = vi.fn();
    render(<TaskEditor task={baseTask} allTags={tags} onClose={onClose} />);

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "" } });
    fireEvent.click(backdrop());

    expect(screen.queryByText(/title can.?t be empty/i)).toBeNull();
    expect(api.updateTask).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not close when clicking outside an unchanged form", () => {
    const onClose = vi.fn();
    render(<TaskEditor task={baseTask} allTags={tags} onClose={onClose} />);

    fireEvent.click(backdrop());

    expect(api.updateTask).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not save or close when a text selection starts inside and releases on the backdrop", () => {
    const onClose = vi.fn();
    render(<TaskEditor task={baseTask} allTags={tags} onClose={onClose} />);

    fireEvent.mouseDown(screen.getByLabelText("Title"));
    fireEvent.mouseUp(backdrop());
    fireEvent.click(backdrop());

    expect(api.updateTask).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});

const templateTask: TemplateTask = {
  id: "k_1", title: "Write report", notes: "", tag_ids: ["t_a"],
  created_at: "1970-01-01T00:00:00Z", start_offset_days: 0, due_offset_days: 2,
};

describe("TaskEditor template editing (#71)", () => {
  it("a template shows relative-offset inputs instead of absolute date pickers", () => {
    render(<TaskEditor kind="template" template={templateTask} allTags={tags} onClose={vi.fn()} />);
    expect(screen.queryByLabelText("Start Date")).toBeNull();
    expect(screen.getByLabelText(/start in \(days\)/i)).toBeTruthy();
    expect(screen.getByLabelText(/due in \(days\)/i)).toBeTruthy();
  });

  it("saves a template's offsets via update_template (no absolute dates)", async () => {
    const onClose = vi.fn();
    render(<TaskEditor kind="template" template={templateTask} allTags={tags} onClose={onClose} />);

    fireEvent.change(screen.getByLabelText(/due in \(days\)/i), { target: { value: "5" } });
    fireEvent.click(button("Save"));

    await waitFor(() =>
      expect(api.updateTemplate).toHaveBeenCalledWith(
        expect.objectContaining({ id: "k_1", due_offset_days: 5, start_offset_days: 0 }),
      ),
    );
    // It's a template payload — no task fields leak in.
    expect(api.updateTask).not.toHaveBeenCalled();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("blocks Save when a template's due offset precedes its scheduled offset (mirrors #51)", () => {
    render(<TaskEditor kind="template"
                       template={{ ...templateTask, start_offset_days: 10, due_offset_days: 3 }}
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
      expect(api.addTemplate).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Write report" }),
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

describe("TaskEditor complete button", () => {
  it("marks an active task done and closes", async () => {
    const onClose = vi.fn();
    render(<TaskEditor task={baseTask} allTags={tags} onClose={onClose} />);

    fireEvent.click(button(/^complete$/i));

    await waitFor(() => expect(api.setTaskDone).toHaveBeenCalledWith("k_1", true));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("saves pending edits before completing", async () => {
    render(<TaskEditor task={baseTask} allTags={tags} onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Edited" } });
    fireEvent.click(button(/^complete$/i));

    await waitFor(() =>
      expect(api.updateTask).toHaveBeenCalledWith(expect.objectContaining({ id: "k_1", title: "Edited" })),
    );
    await waitFor(() => expect(api.setTaskDone).toHaveBeenCalledWith("k_1", true));
  });

  it("shows Reopen for a done task and reopens it (no redundant save)", async () => {
    const doneTask: Task = { ...baseTask, completed_at: "2026-06-01T10:00:00+08:00" };
    render(<TaskEditor task={doneTask} allTags={tags} onClose={vi.fn()} />);

    expect(screen.queryByRole("button", { name: /^complete$/i })).toBeNull();
    fireEvent.click(button(/^reopen$/i));

    await waitFor(() => expect(api.setTaskDone).toHaveBeenCalledWith("k_1", false));
    expect(api.updateTask).not.toHaveBeenCalled();
  });

  it("has no Complete button when creating or editing a template", () => {
    const { unmount } = render(<TaskEditor task={{ ...baseTask, id: "" }} allTags={tags} creating onClose={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /complete|reopen/i })).toBeNull();
    unmount();
    render(<TaskEditor kind="template" template={templateTask} allTags={tags} onClose={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /complete|reopen/i })).toBeNull();
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
