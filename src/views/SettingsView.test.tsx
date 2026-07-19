import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { Document } from "../lib/tauri";
import { isAndroid } from "../lib/platform";
import { SettingsView } from "./SettingsView";

vi.mock("../lib/platform", () => ({
  isAndroid: vi.fn().mockResolvedValue(false),
}));

const {
  pickDataFolder,
  setDataFolder,
  clearDataFolder,
  safStatus,
  getDataLocation,
} = vi.hoisted(() => ({
  pickDataFolder: vi.fn(),
  setDataFolder: vi.fn(),
  clearDataFolder: vi.fn(),
  safStatus: vi.fn(),
  getDataLocation: vi.fn(),
}));

vi.mock("../lib/tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/tauri")>();
  return {
    ...actual,
    api: {
      updateSettings: vi.fn().mockResolvedValue(undefined),
      getDataLocation,
      pickDataFolder,
      setDataFolder,
      clearDataFolder,
      pickAndSetDataFolder: vi.fn(),
      safStatus,
      safPickFolder: vi.fn(),
      safSyncNow: vi.fn(),
      safClearFolder: vi.fn(),
    },
  };
});

const doc: Document = {
  version: 9,
  settings: { theme: "auto", sort_order: "priority" },
  tags: [],
  tasks: [],
  template_tasks: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isAndroid).mockResolvedValue(false);
  getDataLocation.mockResolvedValue({
    folder: "C:\\Sync\\Pansuthong",
    device_id: "device-abc",
    folder_path: "C:\\Sync\\Pansuthong",
    effective_path: "C:\\Sync\\Pansuthong\\tasks_device-abc.json",
  });
  pickDataFolder.mockResolvedValue("D:\\NewSync");
  setDataFolder.mockResolvedValue({
    folder: "D:\\NewSync",
    device_id: "device-abc",
    folder_path: "D:\\NewSync",
    effective_path: "D:\\NewSync\\tasks_device-abc.db",
  });
  clearDataFolder.mockResolvedValue({
    folder: null,
    device_id: "device-abc",
    folder_path: "C:\\AppData",
    effective_path: "C:\\AppData\\tasks_device-abc.db",
  });
  safStatus.mockResolvedValue({
    linked: true,
    folder_label: "Drive/Pansuthong",
    permission_ok: true,
    last_synced_ms: null,
    conflict_count: 0,
    last_error: null,
  });
});

describe("SettingsView data location", () => {
  it("shows the device id and folder path instead of the replica JSON path", async () => {
    render(<SettingsView doc={doc} />);

    await waitFor(() => expect(screen.getByText("device-abc")).toBeTruthy());
    expect(screen.getByText("C:\\Sync\\Pansuthong")).toBeTruthy();
    expect(screen.queryByText("C:\\Sync\\Pansuthong\\tasks_device-abc.json")).toBeNull();
  });

  it("on Android with a linked folder hides local Folder and shows Synced folder only", async () => {
    vi.mocked(isAndroid).mockResolvedValue(true);
    getDataLocation.mockResolvedValue({
      folder: null,
      device_id: "device-abc",
      folder_path: "/data/user/0/net.puetsua.pansutong.dev/files",
      effective_path: "/data/user/0/net.puetsua.pansutong.dev/files/tasks_device-abc.db",
    });

    render(<SettingsView doc={doc} />);

    await waitFor(() => expect(screen.getByText("Drive/Pansuthong")).toBeTruthy());
    expect(screen.getByText(/Synced folder:/i)).toBeTruthy();
    // Local app-data path must not appear once SAF is linked (one-folder UX).
    expect(screen.queryByText("/data/user/0/net.puetsua.pansutong.dev/files")).toBeNull();
    expect(screen.getByRole("button", { name: /sync now/i })).toBeTruthy();
  });

  it("shows Copy / Move / Cancel after picking a folder; Cancel does not invoke", async () => {
    render(<SettingsView doc={doc} />);
    await waitFor(() => expect(screen.getByText("device-abc")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /choose folder/i }));
    await waitFor(() => expect(pickDataFolder).toHaveBeenCalled());

    const dialog = await screen.findByRole("dialog", { name: /change data folder/i });
    expect(within(dialog).getByRole("heading", { name: /change data folder/i })).toBeTruthy();
    const actions = within(dialog).getAllByRole("button");
    expect(actions.map(b => b.textContent)).toEqual(["Cancel", "Move", "Copy"]);

    fireEvent.click(within(dialog).getByRole("button", { name: /cancel/i }));
    expect(setDataFolder).not.toHaveBeenCalled();
    expect(clearDataFolder).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("invokes setDataFolder with copy when Copy is chosen", async () => {
    render(<SettingsView doc={doc} />);
    await waitFor(() => expect(screen.getByText("device-abc")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /choose folder/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /^copy$/i }));

    await waitFor(() =>
      expect(setDataFolder).toHaveBeenCalledWith("D:\\NewSync", "copy"),
    );
  });

  it("invokes setDataFolder with move when Move is chosen", async () => {
    render(<SettingsView doc={doc} />);
    await waitFor(() => expect(screen.getByText("device-abc")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /choose folder/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /^move$/i }));

    await waitFor(() =>
      expect(setDataFolder).toHaveBeenCalledWith("D:\\NewSync", "move"),
    );
  });

  it("shows the transfer dialog for clear; Copy invokes clearDataFolder", async () => {
    render(<SettingsView doc={doc} />);
    await waitFor(() => expect(screen.getByText("device-abc")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /use default/i }));
    const dialog = await screen.findByRole("dialog");
    expect(clearDataFolder).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: /^copy$/i }));
    await waitFor(() => expect(clearDataFolder).toHaveBeenCalledWith("copy"));
  });
});
