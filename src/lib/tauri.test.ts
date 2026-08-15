import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the IPC boundary so we can assert the exact command name and argument
// shape each `api.*` wrapper sends. This is the most fragile cross-language seam:
// a renamed command or a mis-cased arg key compiles fine but fails only at runtime (#42).
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { api } from "./tauri";

const invokeMock = vi.mocked(invoke);
const openMock = vi.mocked(open);

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue(undefined as never);
  openMock.mockReset();
});

describe("api IPC wrappers — command names & arg keys", () => {
  it("getDocument → get_document (no args)", async () => {
    await api.getDocument();
    expect(invokeMock).toHaveBeenCalledWith("get_document");
  });

  it("tryOpenData → try_open_data (no args)", async () => {
    await api.tryOpenData();
    expect(invokeMock).toHaveBeenCalledWith("try_open_data");
  });

  it("openDefaultStore → open_default_store (no args)", async () => {
    await api.openDefaultStore();
    expect(invokeMock).toHaveBeenCalledWith("open_default_store");
  });

  it("addTask wraps the payload under `input`", async () => {
    await api.addTask({ title: "Buy milk" });
    expect(invokeMock).toHaveBeenCalledWith("add_task", { input: { title: "Buy milk" } });
  });

  it("attachmentUrl reads bytes via read_attachment and returns a blob: URL", async () => {
    invokeMock.mockResolvedValueOnce(new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer as never);
    // jsdom has no createObjectURL; stub it to observe the Blob and return a URL.
    const createObjectURL = vi.fn((_blob: Blob) => "blob:stub-url");
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = createObjectURL;

    const url = await api.attachmentUrl("attachments_dev/attachment_x.png");

    expect(invokeMock).toHaveBeenCalledWith("read_attachment", { path: "attachments_dev/attachment_x.png" });
    expect(createObjectURL.mock.calls[0][0]).toBeInstanceOf(Blob);
    expect(url).toBe("blob:stub-url");
  });

  it("updateTask wraps the payload under `input`", async () => {
    const input = { id: "k_1", title: "x", tag_ids: ["t_a"] };
    await api.updateTask(input);
    expect(invokeMock).toHaveBeenCalledWith("update_task", { input });
  });

  it("setTaskDone → set_task_done with camelCase-free scalar args", async () => {
    await api.setTaskDone("k_1", true);
    expect(invokeMock).toHaveBeenCalledWith("set_task_done", { id: "k_1", done: true });
  });

  it("deleteTask → delete_task { id }", async () => {
    await api.deleteTask("k_1");
    expect(invokeMock).toHaveBeenCalledWith("delete_task", { id: "k_1" });
  });

  it("duplicateTask → duplicate_task { id }", async () => {
    await api.duplicateTask("k_1");
    expect(invokeMock).toHaveBeenCalledWith("duplicate_task", { id: "k_1" });
  });

  it("duplicateTemplate → duplicate_template { id }", async () => {
    await api.duplicateTemplate("tpl_1");
    expect(invokeMock).toHaveBeenCalledWith("duplicate_template", { id: "tpl_1" });
  });

  it("addTag wraps name/color/priority/pinned under `input`, defaulting priority to 0 and pinned to false", async () => {
    await api.addTag("work", "#fff");
    expect(invokeMock).toHaveBeenCalledWith("add_tag", { input: { name: "work", color: "#fff", priority: 0, pinned: false } });
    await api.addTag("work", "#fff", 5, true);
    expect(invokeMock).toHaveBeenCalledWith("add_tag", { input: { name: "work", color: "#fff", priority: 5, pinned: true } });
  });

  it("deleteTag → delete_tag { id }", async () => {
    await api.deleteTag("t_1");
    expect(invokeMock).toHaveBeenCalledWith("delete_tag", { id: "t_1" });
  });

  it("updateTag wraps under `input`", async () => {
    const input = { id: "t_1", name: "office", color: "#000", priority: 3 };
    await api.updateTag(input);
    expect(invokeMock).toHaveBeenCalledWith("update_tag", { input });
  });

  it("updateSettings wraps theme/sort_order/upcoming_days/new-tag defaults under `input`", async () => {
    await api.updateSettings({ theme: "dark" });
    expect(invokeMock).toHaveBeenCalledWith("update_settings", { input: { theme: "dark" } });
    await api.updateSettings({ sort_order: "date" });
    expect(invokeMock).toHaveBeenCalledWith("update_settings", { input: { sort_order: "date" } });
    await api.updateSettings({ upcoming_days: 30 });
    expect(invokeMock).toHaveBeenCalledWith("update_settings", { input: { upcoming_days: 30 } });
    await api.updateSettings({ default_tag_color: "#ef4444" });
    expect(invokeMock).toHaveBeenCalledWith("update_settings", { input: { default_tag_color: "#ef4444" } });
    await api.updateSettings({ default_tag_priority: 7 });
    expect(invokeMock).toHaveBeenCalledWith("update_settings", { input: { default_tag_priority: 7 } });
  });

  it("listConflicts → list_conflicts", async () => {
    await api.listConflicts();
    expect(invokeMock).toHaveBeenCalledWith("list_conflicts");
  });

  it("readConflict → read_conflict { conflictPath } (camelCase key)", async () => {
    await api.readConflict("/p/x.json");
    expect(invokeMock).toHaveBeenCalledWith("read_conflict", { conflictPath: "/p/x.json" });
  });

  it("resolveConflict → resolve_conflict { input: { conflict_path, decisions } } (snake_case inside input)", async () => {
    const decisions = [{ action: "keep_mine", id: "k_1" }] as const;
    await api.resolveConflict("/p/x.json", [...decisions]);
    expect(invokeMock).toHaveBeenCalledWith("resolve_conflict", {
      input: { conflict_path: "/p/x.json", decisions: [...decisions] },
    });
  });

  it("dismissConflict → dismiss_conflict { conflictPath }", async () => {
    await api.dismissConflict("/p/x.json");
    expect(invokeMock).toHaveBeenCalledWith("dismiss_conflict", { conflictPath: "/p/x.json" });
  });

  it("getDataLocation → get_data_location", async () => {
    await api.getDataLocation();
    expect(invokeMock).toHaveBeenCalledWith("get_data_location");
  });

  it("clearDataFolder → clear_data_folder with transferMode", async () => {
    await api.clearDataFolder("copy");
    expect(invokeMock).toHaveBeenCalledWith("clear_data_folder", { transferMode: "copy" });
  });
});

describe("pickAndSetDataFolder", () => {
  it("invokes set_data_folder with the chosen folder and transfer mode when a directory is picked", async () => {
    openMock.mockResolvedValue("/home/me/sync");
    await api.pickAndSetDataFolder("move");
    expect(invokeMock).toHaveBeenCalledWith("set_data_folder", {
      folder: "/home/me/sync",
      transferMode: "move",
    });
  });

  it("returns null and never invokes when the picker is cancelled", async () => {
    openMock.mockResolvedValue(null as never);
    const result = await api.pickAndSetDataFolder("copy");
    expect(result).toBeNull();
    expect(invokeMock).not.toHaveBeenCalled();
  });
});

describe("pickDataFolder / setDataFolder", () => {
  it("pickDataFolder returns the chosen path without invoking set_data_folder", async () => {
    openMock.mockResolvedValue("/home/me/sync");
    const result = await api.pickDataFolder();
    expect(result).toBe("/home/me/sync");
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("setDataFolder invokes with folder and transferMode", async () => {
    await api.setDataFolder("/home/me/sync", "copy");
    expect(invokeMock).toHaveBeenCalledWith("set_data_folder", {
      folder: "/home/me/sync",
      transferMode: "copy",
    });
  });
});
