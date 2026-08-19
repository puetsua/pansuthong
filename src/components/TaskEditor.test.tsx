import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, createEvent, waitFor, within } from "@testing-library/react";
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
      duplicateTask: vi.fn().mockResolvedValue({}),
      deleteTask: vi.fn().mockResolvedValue(undefined),
      addTemplate: vi.fn().mockResolvedValue({}),
      updateTemplate: vi.fn().mockResolvedValue({}),
      duplicateTemplate: vi.fn().mockResolvedValue({}),
      deleteTemplate: vi.fn().mockResolvedValue(undefined),
      addTag: vi.fn((name: string, color: string) =>
        Promise.resolve({ id: `t_new_${name}`, name, color, priority: 0 })),
      attachmentUrl: vi.fn().mockResolvedValue("asset://localhost/att.png"),
      revealAttachment: vi.fn().mockResolvedValue(undefined),
      openAttachment: vi.fn().mockResolvedValue(undefined),
      removeTaskAttachment: vi.fn().mockResolvedValue({
        id: "k_1", title: "Write report", notes: "",
        tag_ids: ["t_a"], created_at: "1970-01-01T00:00:00Z", attachments: [],
      }),
      attachTaskBytes: vi.fn(),
    },
  };
});

import { api } from "../lib/tauri";
import { playCompletionSound } from "../lib/sound";

vi.mock("../lib/sound", () => ({
  playCompletionSound: vi.fn(),
}));

const baseTask: Task = {
  id: "k_1", title: "Write report",
  notes: "", tag_ids: ["t_a"], created_at: "1970-01-01T00:00:00Z",
};
const tags = new Map<string, Tag>([
  ["t_a", { id: "t_a", name: "work", color: "#06b6d4", priority: 5 }],
  ["t_b", { id: "t_b", name: "home", color: "#ef4444", priority: 1 }],
]);

const button = (name: RegExp | string) => screen.getByRole("button", { name }) as HTMLButtonElement;

// The attachments section is collapsed by default; expand it so its list
// buttons (insert/reveal/delete/thumbnail) are in the DOM.
const expandAttachments = () => fireEvent.click(screen.getByRole("button", { name: /Attachments/ }));

// Fire a paste carrying files. jsdom's synthetic paste event drops the
// `clipboardData` init prop, so attach it explicitly before dispatching.
const pasteFiles = (node: HTMLElement, files: File[]) => {
  // jsdom's File lacks arrayBuffer(); the app reads it to get the bytes.
  files.forEach(f => {
    if (typeof f.arrayBuffer !== "function") {
      Object.defineProperty(f, "arrayBuffer", { value: async () => new Uint8Array([0]).buffer });
    }
  });
  const event = createEvent.paste(node);
  Object.defineProperty(event, "clipboardData", { value: { files } });
  fireEvent(node, event);
};

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

describe("TaskEditor estimated time", () => {
  it("saves estimated seconds for an existing task", async () => {
    render(<TaskEditor task={baseTask} allTags={tags} onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Estimated time"), { target: { value: "1h" } });
    fireEvent.click(button("Save"));

    await waitFor(() =>
      expect(api.updateTask).toHaveBeenCalledWith(
        expect.objectContaining({ id: "k_1", estimated_seconds: 3_600 }),
      ),
    );
  });

  it("blocks Save when estimated seconds are invalid", () => {
    render(<TaskEditor task={baseTask} allTags={tags} onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Estimated time"), { target: { value: "0" } });

    expect(screen.getByText(/estimated time must be/i)).toBeTruthy();
    expect(button("Save").disabled).toBe(true);
  });
});

describe("TaskEditor Markdown notes (#70)", () => {
  it("opens a task with existing notes in the rendered preview by default", () => {
    const task: Task = {
      ...baseTask,
      notes: "Hello **bold**\n\n- first",
    };
    render(<TaskEditor task={task} allTags={tags} onClose={vi.fn()} />);

    // Preview is shown (markdown rendered) and the raw editor is hidden.
    expect(button("Preview").getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByLabelText("Markdown notes")).toBeNull();
    expect(screen.getByText("bold").tagName).toBe("STRONG");
    expect(screen.getByText("first").tagName).toBe("LI");
  });

  it("opens a task with empty notes in edit mode", () => {
    render(<TaskEditor task={baseTask} allTags={tags} onClose={vi.fn()} />);

    expect(button("Edit").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByLabelText("Markdown notes")).toBeTruthy();
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

const imgAtt = {
  id: "att_1", name: "shot.png", path: "attachments_dev/attachment_att_1_shot.png",
  mime_type: "image/png", size: 1234, created_at: "1970-01-01T00:00:00Z",
};
const fileAtt = {
  id: "att_2", name: "doc.pdf", path: "attachments_dev/attachment_att_2_doc.pdf",
  mime_type: "application/pdf", size: 2048, created_at: "1970-01-01T00:00:00Z",
};

describe("TaskEditor attachments in notes (#113)", () => {
  it("renders a managed image reference inline and opens it in the lightbox", async () => {
    const task: Task = { ...baseTask, notes: `![shot](${imgAtt.path})`, attachments: [imgAtt] };
    render(<TaskEditor task={task} allTags={tags} onClose={vi.fn()} />);

    const img = await waitFor(() => {
      const el = document.querySelector(".te-md-image") as HTMLImageElement | null;
      if (!el) throw new Error("inline image not rendered yet");
      return el;
    });
    expect(img.getAttribute("src")).toBe("asset://localhost/att.png");

    fireEvent.click(img);
    expect(document.querySelector(".te-lightbox img")).not.toBeNull();
  });

  it("opens a managed file link in the default app instead of navigating", () => {
    const task: Task = { ...baseTask, notes: `[doc](${fileAtt.path})`, attachments: [fileAtt] };
    render(<TaskEditor task={task} allTags={tags} onClose={vi.fn()} />);

    fireEvent.click(screen.getByText("doc"));
    expect(api.openAttachment).toHaveBeenCalledWith(fileAtt.path);
  });

  it("falls back to alt text for a non-managed image reference", () => {
    const task: Task = { ...baseTask, notes: "![ext](https://example.com/x.png)" };
    render(<TaskEditor task={task} allTags={tags} onClose={vi.fn()} />);

    expect(document.querySelector(".te-md-image")).toBeNull();
    expect(screen.getByText("ext")).toBeTruthy();
  });

  it("inserts an image attachment as image markdown into the notes", () => {
    const task: Task = { ...baseTask, attachments: [imgAtt] };
    render(<TaskEditor task={task} allTags={tags} onClose={vi.fn()} />);

    expandAttachments();
    fireEvent.click(button("Insert shot.png into notes"));
    const ta = screen.getByLabelText("Markdown notes") as HTMLTextAreaElement;
    expect(ta.value).toContain(`![shot.png](${imgAtt.path})`);
  });

  it("inserts a file attachment as a link into the notes", () => {
    const task: Task = { ...baseTask, attachments: [fileAtt] };
    render(<TaskEditor task={task} allTags={tags} onClose={vi.fn()} />);

    expandAttachments();
    fireEvent.click(button("Insert doc.pdf into notes"));
    const ta = screen.getByLabelText("Markdown notes") as HTMLTextAreaElement;
    expect(ta.value).toContain(`[doc.pdf](${fileAtt.path})`);
    expect(ta.value).not.toContain(`![doc.pdf]`);
  });

  it("is collapsed by default and toggles open/closed", () => {
    const task: Task = { ...baseTask, attachments: [fileAtt] };
    render(<TaskEditor task={task} allTags={tags} onClose={vi.fn()} />);

    // Collapsed by default — the attachment is hidden.
    const toggle = screen.getByRole("button", { name: /Attachments/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("button", { name: "doc.pdf" })).toBeNull();

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.queryByRole("button", { name: "doc.pdf" })).toBeTruthy();

    fireEvent.click(toggle);
    expect(screen.queryByRole("button", { name: "doc.pdf" })).toBeNull();
  });

  it("auto-expands the section when a new attachment is pasted", async () => {
    (api.attachTaskBytes as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...baseTask, attachments: [imgAtt],
    });
    render(<TaskEditor task={baseTask} allTags={tags} onClose={vi.fn()} />);

    expect(screen.getByRole("button", { name: /Attachments/ }).getAttribute("aria-expanded")).toBe("false");
    const ta = screen.getByLabelText("Markdown notes") as HTMLTextAreaElement;
    pasteFiles(ta, [new File([new Uint8Array([1])], "shot.png", { type: "image/png" })]);

    // The added attachment becomes visible without a manual toggle.
    await waitFor(() => expect(screen.getByRole("button", { name: "shot.png" })).toBeTruthy());
    expect(screen.getByRole("button", { name: /Attachments/ }).getAttribute("aria-expanded")).toBe("true");
  });

  it("reveals an attachment in the file manager when its name is clicked", () => {
    const task: Task = { ...baseTask, attachments: [fileAtt] };
    render(<TaskEditor task={task} allTags={tags} onClose={vi.fn()} />);

    expandAttachments();
    fireEvent.click(button("doc.pdf"));
    expect(api.revealAttachment).toHaveBeenCalledWith(fileAtt.path);
  });

  it("confirms via a dialog before deleting an attachment", () => {
    const task: Task = { ...baseTask, attachments: [fileAtt] };
    render(<TaskEditor task={task} allTags={tags} onClose={vi.fn()} />);

    expandAttachments();
    // Clicking × opens a confirmation dialog rather than deleting immediately.
    fireEvent.click(button("Remove doc.pdf"));
    expect(api.removeTaskAttachment).not.toHaveBeenCalled();
    const dialog = () => screen.getByRole("dialog", { name: /Delete doc\.pdf\?/ });

    // Cancelling dismisses without deleting.
    fireEvent.click(within(dialog()).getByRole("button", { name: "Cancel" }));
    expect(api.removeTaskAttachment).not.toHaveBeenCalled();

    // Re-open and confirm → the delete goes through.
    fireEvent.click(button("Remove doc.pdf"));
    fireEvent.click(within(dialog()).getByRole("button", { name: "Delete" }));
    expect(api.removeTaskAttachment).toHaveBeenCalledWith("k_1", "att_2");
  });

  it("opens the lightbox when an image thumbnail is clicked", async () => {
    const task: Task = { ...baseTask, attachments: [imgAtt] };
    render(<TaskEditor task={task} allTags={tags} onClose={vi.fn()} />);

    expandAttachments();
    const thumb = await waitFor(() => button(/Enlarge shot.png/));
    fireEvent.click(thumb);
    expect(document.querySelector(".te-lightbox img")).not.toBeNull();
  });

  it("shows a broken-link marker for an image ref whose attachment was deleted", () => {
    // The note references a managed image, but it is no longer in the
    // attachment list (deleted) — so the preview must not try to load it.
    const task: Task = { ...baseTask, notes: `![shot](${imgAtt.path})`, attachments: [] };
    render(<TaskEditor task={task} allTags={tags} onClose={vi.fn()} />);

    expect(document.querySelector(".te-md-image-broken")).not.toBeNull();
    expect(document.querySelector(".te-md-image")).toBeNull();
  });

  it("swaps an inline image for the broken marker when its attachment is deleted", async () => {
    const task: Task = { ...baseTask, notes: `![shot](${imgAtt.path})`, attachments: [imgAtt] };
    (api.removeTaskAttachment as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...task, attachments: [],
    });
    render(<TaskEditor task={task} allTags={tags} onClose={vi.fn()} />);

    // Initially the image renders...
    await waitFor(() => expect(document.querySelector(".te-md-image")).not.toBeNull());

    // ...delete it via the list, confirm, and the preview shows broken instead.
    expandAttachments();
    fireEvent.click(button("Remove shot.png"));
    fireEvent.click(within(screen.getByRole("dialog", { name: /Delete shot\.png\?/ })).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(document.querySelector(".te-md-image-broken")).not.toBeNull());
    expect(document.querySelector(".te-md-image")).toBeNull();
  });

  it("shows a loading indicator while an attachment is saving", async () => {
    let resolve!: (t: Task) => void;
    (api.attachTaskBytes as ReturnType<typeof vi.fn>).mockReturnValue(
      new Promise<Task>(r => { resolve = r; }),
    );
    render(<TaskEditor task={baseTask} allTags={tags} onClose={vi.fn()} />);

    const ta = screen.getByLabelText("Markdown notes") as HTMLTextAreaElement;
    pasteFiles(ta, [new File([new Uint8Array([1])], "shot.png", { type: "image/png" })]);

    await waitFor(() => expect(screen.getByText("Saving attachment…")).toBeTruthy());
    resolve({ ...baseTask, attachments: [imgAtt] });
    await waitFor(() => expect(screen.queryByText("Saving attachment…")).toBeNull());
  });

  it("pastes an image into the notes, saving it and inserting image markdown", async () => {
    (api.attachTaskBytes as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...baseTask, attachments: [imgAtt],
    });
    render(<TaskEditor task={baseTask} allTags={tags} onClose={vi.fn()} />);

    const ta = screen.getByLabelText("Markdown notes") as HTMLTextAreaElement;
    const file = new File([new Uint8Array([1, 2, 3])], "shot.png", { type: "image/png" });
    pasteFiles(ta, [file]);

    await waitFor(() =>
      expect(api.attachTaskBytes).toHaveBeenCalledWith(
        "k_1", "shot.png", "image/png", expect.any(Uint8Array),
      ),
    );
    await waitFor(() => expect(ta.value).toContain(`![shot.png](${imgAtt.path})`));
  });

  it("pastes a non-image file, saving it and inserting link markdown", async () => {
    (api.attachTaskBytes as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...baseTask, attachments: [fileAtt],
    });
    render(<TaskEditor task={baseTask} allTags={tags} onClose={vi.fn()} />);

    const ta = screen.getByLabelText("Markdown notes") as HTMLTextAreaElement;
    const file = new File([new Uint8Array([1])], "doc.pdf", { type: "application/pdf" });
    pasteFiles(ta, [file]);

    await waitFor(() => expect(api.attachTaskBytes).toHaveBeenCalled());
    await waitFor(() => expect(ta.value).toContain(`[doc.pdf](${fileAtt.path})`));
    // A non-image must NOT get the image (!) prefix.
    expect(ta.value).not.toContain(`![doc.pdf]`);
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

describe("TaskEditor close with unsaved changes", () => {
  const closeBtn = () => button("Close");
  const saveDialog = () => screen.getByRole("dialog", { name: /save your changes before closing/i });

  it("closes immediately when nothing has changed", () => {
    const onClose = vi.fn();
    render(<TaskEditor task={baseTask} allTags={tags} onClose={onClose} />);

    fireEvent.click(closeBtn());
    expect(screen.queryByRole("dialog", { name: /save your changes before closing/i })).toBeNull();
    expect(onClose).toHaveBeenCalled();
  });

  it("prompts to save when closing a dirty editor and saves on confirm", async () => {
    const onClose = vi.fn();
    render(<TaskEditor task={baseTask} allTags={tags} onClose={onClose} />);

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Edited title" } });
    fireEvent.click(closeBtn());

    // The editor stays open behind a Save / Discard / Cancel prompt.
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(within(saveDialog()).getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(api.updateTask).toHaveBeenCalledWith(expect.objectContaining({ id: "k_1", title: "Edited title" })),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("discards changes and closes without saving", () => {
    const onClose = vi.fn();
    render(<TaskEditor task={baseTask} allTags={tags} onClose={onClose} />);

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Edited title" } });
    fireEvent.click(closeBtn());
    fireEvent.click(within(saveDialog()).getByRole("button", { name: "Discard" }));

    expect(api.updateTask).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("cancels the prompt and keeps the editor open", () => {
    const onClose = vi.fn();
    render(<TaskEditor task={baseTask} allTags={tags} onClose={onClose} />);

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Edited title" } });
    fireEvent.click(closeBtn());
    fireEvent.click(within(saveDialog()).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog", { name: /save your changes before closing/i })).toBeNull();
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
    fireEvent.change(screen.getByLabelText("Estimated time"), { target: { value: "1h" } });
    fireEvent.click(button("Save"));

    await waitFor(() =>
      expect(api.updateTemplate).toHaveBeenCalledWith(
        expect.objectContaining({ id: "k_1", due_offset_days: 5, start_offset_days: 0, estimated_seconds: 3_600 }),
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

  it("disables and clears Start in when a recurrence tag is configured", async () => {
    render(<TaskEditor kind="template"
                       template={{
                         ...templateTask,
                         start_offset_days: 10,
                         due_offset_days: 3,
                         recurrence: { kind: "weekly", weekdays: [1] },
                         recurrence_tag_id: "t_a",
                       }}
                       allTags={tags} onClose={vi.fn()} />);

    const start = screen.getByLabelText(/start in \(days\)/i) as HTMLInputElement;
    expect(start.disabled).toBe(true);
    expect(start.value).toBe("");
    expect(screen.queryByText(/due offset can.?t be before/i)).toBeNull();

    fireEvent.click(button("Save"));

    await waitFor(() =>
      expect(api.updateTemplate).toHaveBeenCalledWith(
        expect.objectContaining({ id: "k_1", start_offset_days: null, due_offset_days: 3 }),
      ),
    );
  });

  it("shows an existing template estimate as editable duration text", () => {
    render(<TaskEditor kind="template"
                       template={{ ...templateTask, estimated_seconds: 3_600 }}
                       allTags={tags} onClose={vi.fn()} />);
    const estimate = screen.getByLabelText("Estimated time") as HTMLInputElement;
    // The template estimate sits above the notes field, not below the attachments (#…).
    const notes = screen.getByLabelText("Markdown notes");
    expect(estimate.compareDocumentPosition(notes) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(estimate.value).toBe("1h");
  });
});

describe("TaskEditor 'Save as template' option (#71)", () => {
  it("creates a template copy via the Options menu and keeps the task (no convert)", async () => {
    render(<TaskEditor task={{ ...baseTask, estimated_seconds: 50 }} allTags={tags} onClose={vi.fn()} />);
    // There is no always-visible toggle — it lives behind the Options menu.
    expect(screen.queryByRole("checkbox", { name: /save as template/i })).toBeNull();

    fireEvent.click(button(/options/i));
    fireEvent.click(screen.getByRole("menuitem", { name: /save as template/i }));

    await waitFor(() =>
      expect(api.addTemplate).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Write report", estimated_seconds: 50 }),
      ),
    );
    // The original task is untouched — saving-as-template does not convert it.
    expect(api.updateTask).not.toHaveBeenCalled();
  });
});

describe("TaskEditor duplicate option", () => {
  it("duplicates a task via the Options menu", async () => {
    const onClose = vi.fn();
    render(<TaskEditor task={baseTask} allTags={tags} onClose={onClose} />);

    fireEvent.click(button(/options/i));
    fireEvent.click(screen.getByRole("menuitem", { name: /^duplicate$/i }));

    await waitFor(() => expect(api.duplicateTask).toHaveBeenCalledWith("k_1"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("duplicates a template via the Options menu", async () => {
    const onClose = vi.fn();
    render(<TaskEditor kind="template" template={templateTask} allTags={tags} onClose={onClose} />);

    fireEvent.click(button(/options/i));
    fireEvent.click(screen.getByRole("menuitem", { name: /^duplicate$/i }));

    await waitFor(() => expect(api.duplicateTemplate).toHaveBeenCalledWith("k_1"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
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

  it("adds a new task with estimated seconds", async () => {
    const draft: Task = { ...baseTask, id: "", title: "New with estimate" };
    render(<TaskEditor task={draft} allTags={tags} creating onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Estimated time"), { target: { value: "50s" } });
    fireEvent.click(button(/add task/i));

    await waitFor(() =>
      expect(api.addTask).toHaveBeenCalledWith(expect.objectContaining({
        title: "New with estimate",
        estimated_seconds: 50,
      })),
    );
  });
});

describe("TaskEditor complete checkbox", () => {
  const completeBox = () => screen.getByRole("checkbox", { name: /toggle write report/i }) as HTMLInputElement;

  it("shows an unchecked checkbox for an open task", () => {
    render(<TaskEditor task={baseTask} allTags={tags} onClose={vi.fn()} />);
    expect(completeBox().checked).toBe(false);
    expect(screen.queryByRole("button", { name: /^complete$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^reopen$/i })).toBeNull();
  });

  it("shows a checked checkbox for a done task", () => {
    const doneTask: Task = { ...baseTask, completed_at: "2026-06-01T10:00:00+08:00" };
    render(<TaskEditor task={doneTask} allTags={tags} onClose={vi.fn()} />);
    expect(completeBox().checked).toBe(true);
  });

  it("marks an active task done and stays open", async () => {
    const onClose = vi.fn();
    const onCompleted = vi.fn();
    const { rerender } = render(
      <TaskEditor task={baseTask} allTags={tags} onClose={onClose} onCompleted={onCompleted} />,
    );

    fireEvent.click(completeBox());

    await waitFor(() => expect(api.setTaskDone).toHaveBeenCalledWith("k_1", true));
    expect(onClose).not.toHaveBeenCalled();
    expect(onCompleted).toHaveBeenCalledWith("k_1");
    expect(playCompletionSound).toHaveBeenCalled();

    rerender(<TaskEditor task={{ ...baseTask, completed_at: "2026-06-01T10:00:00+08:00" }} allTags={tags} onClose={onClose} />);
    expect(completeBox().checked).toBe(true);
  });

  it("saves pending edits before completing", async () => {
    render(<TaskEditor task={baseTask} allTags={tags} onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Edited" } });
    fireEvent.click(completeBox());

    await waitFor(() =>
      expect(api.updateTask).toHaveBeenCalledWith(expect.objectContaining({ id: "k_1", title: "Edited" })),
    );
    await waitFor(() => expect(api.setTaskDone).toHaveBeenCalledWith("k_1", true));
  });

  it("reopens a done task without a redundant save and stays open", async () => {
    const doneTask: Task = { ...baseTask, completed_at: "2026-06-01T10:00:00+08:00" };
    const onClose = vi.fn();
    render(<TaskEditor task={doneTask} allTags={tags} onClose={onClose} />);

    fireEvent.click(completeBox());

    await waitFor(() => expect(api.setTaskDone).toHaveBeenCalledWith("k_1", false));
    expect(api.updateTask).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(playCompletionSound).not.toHaveBeenCalled();
  });

  it("has no completion checkbox when creating or editing a template", () => {
    const { unmount } = render(<TaskEditor task={{ ...baseTask, id: "" }} allTags={tags} creating onClose={vi.fn()} />);
    expect(screen.queryByRole("checkbox", { name: /toggle/i })).toBeNull();
    unmount();
    render(<TaskEditor kind="template" template={templateTask} allTags={tags} onClose={vi.fn()} />);
    expect(screen.queryByRole("checkbox", { name: /toggle/i })).toBeNull();
  });
});

describe("TaskEditor title focus (#160)", () => {
  // React autoFocus calls focus() and does not set the HTML attribute. Spy so a
  // later dialog.focus() cannot hide a title autoFocus via activeElement.
  function titleReceivedFocus(renderEditor: () => void): boolean {
    const focus = vi.spyOn(HTMLElement.prototype, "focus");
    try {
      renderEditor();
      return focus.mock.contexts.includes(screen.getByLabelText("Title"));
    } finally {
      focus.mockRestore();
    }
  }

  it("does not focus the title when opening an existing task", () => {
    expect(titleReceivedFocus(() => {
      render(<TaskEditor task={baseTask} allTags={tags} onClose={vi.fn()} />);
    })).toBe(false);
    expect(document.activeElement).toBe(screen.getByRole("dialog"));
  });

  it("does not focus the title when opening an existing template", () => {
    expect(titleReceivedFocus(() => {
      render(<TaskEditor kind="template" template={templateTask} allTags={tags} onClose={vi.fn()} />);
    })).toBe(false);
    expect(document.activeElement).toBe(screen.getByRole("dialog"));
  });

  it("autofocuses the title when creating", () => {
    expect(titleReceivedFocus(() => {
      render(<TaskEditor task={{ ...baseTask, id: "", title: "" }} allTags={tags} creating onClose={vi.fn()} />);
    })).toBe(true);
    expect(document.activeElement).toBe(screen.getByLabelText("Title"));
  });

  it("autofocuses the title when creating from a filled draft", () => {
    expect(titleReceivedFocus(() => {
      render(<TaskEditor task={{ ...baseTask, id: "", title: "From template" }} allTags={tags} creating onClose={vi.fn()} />);
    })).toBe(true);
    expect(document.activeElement).toBe(screen.getByLabelText("Title"));
  });

  it("autofocuses the title when creating a template", () => {
    expect(titleReceivedFocus(() => {
      render(<TaskEditor kind="template" template={{ ...templateTask, id: "", title: "" }} allTags={tags} creating onClose={vi.fn()} />);
    })).toBe(true);
    expect(document.activeElement).toBe(screen.getByLabelText("Title"));
  });

  it("wraps Tab from the parked dialog to the first control", () => {
    render(<TaskEditor task={baseTask} allTags={tags} onClose={vi.fn()} />);
    expect(document.activeElement).toBe(screen.getByRole("dialog"));
    fireEvent.keyDown(window, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByRole("checkbox", { name: /toggle write report/i }));
  });

  it("wraps Shift+Tab from the parked dialog to the last control", () => {
    render(<TaskEditor task={baseTask} allTags={tags} onClose={vi.fn()} />);
    expect(document.activeElement).toBe(screen.getByRole("dialog"));
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /^save$/i }));
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
