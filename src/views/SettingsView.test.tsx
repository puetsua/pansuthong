import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { api, Document, type McpStatus } from "../lib/tauri";
import { __resetPlatformCacheForTests, isAndroid } from "../lib/platform";
import { SettingsView } from "./SettingsView";

vi.mock("../lib/platform", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/platform")>();
  return {
    ...actual,
    isAndroid: vi.fn().mockResolvedValue(false),
  };
});

const {
  pickDataFolder,
  setDataFolder,
  clearDataFolder,
  inspectDataFolder,
  safStatus,
  getDataLocation,
} = vi.hoisted(() => ({
  pickDataFolder: vi.fn(),
  setDataFolder: vi.fn(),
  clearDataFolder: vi.fn(),
  inspectDataFolder: vi.fn(),
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
      inspectDataFolder,
      pickAndSetDataFolder: vi.fn(),
      safStatus,
      safPickFolder: vi.fn(),
      safSyncNow: vi.fn(),
      safClearFolder: vi.fn(),
      getMcpStatus: vi.fn().mockResolvedValue({ status: "off" }),
      regenerateMcpToken: vi.fn().mockResolvedValue("test-token"),
      onMcpStatusChanged: vi.fn().mockResolvedValue(() => {}),
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
  inspectDataFolder.mockResolvedValue({ has_data: false, is_current: false });
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

describe("SettingsView MCP server", () => {
  beforeEach(() => {
    __resetPlatformCacheForTests();
  });

  it("shows the MCP section on desktop", async () => {
    render(<SettingsView doc={doc} />);
    expect(screen.getByRole("heading", { name: /MCP server/i })).toBeTruthy();
  });

  const mcpDoc: Document = {
    ...doc,
    settings: { ...doc.settings, mcp_enabled: true, mcp_port: 7373, mcp_token: "tok" },
  };

  it("shows the port-in-use status under the Port field", async () => {
    vi.mocked(api.getMcpStatus).mockResolvedValue({ status: "port_in_use", message: "7373 is taken" });
    render(<SettingsView doc={mcpDoc} />);
    const note = await screen.findByText(/Port in use.*7373 is taken/, { selector: ".mcp-port-error" });
    expect(note.getAttribute("role")).toBe("alert");
    expect(note.closest("label")?.querySelector("input")?.getAttribute("inputmode")).toBe("numeric");
  });

  it("updates the status from mcp-status-changed events", async () => {
    vi.mocked(api.getMcpStatus).mockResolvedValue({ status: "listening" });
    let push: ((s: McpStatus) => void) | undefined;
    vi.mocked(api.onMcpStatusChanged).mockImplementation(async (cb) => {
      push = cb;
      return () => {};
    });
    render(<SettingsView doc={mcpDoc} />);
    await screen.findByText(/Listening/);
    await waitFor(() => expect(push).toBeDefined());
    act(() => push!({ status: "port_in_use", message: "taken" }));
    await screen.findByText(/Port in use.*taken/, { selector: ".mcp-port-error" });
    expect(screen.getAllByText(/Port in use/)).toHaveLength(1);
  });

  it("prefers the port validation error over the port-in-use status", async () => {
    vi.mocked(api.getMcpStatus).mockResolvedValue({ status: "port_in_use", message: "7373 is taken" });
    render(<SettingsView doc={mcpDoc} />);
    const note = await screen.findByText(/Port in use/, { selector: ".mcp-port-error" });
    const input = note.closest("label")!.querySelector("input")!;
    fireEvent.change(input, { target: { value: "80" } });
    fireEvent.blur(input);
    const alerts = await screen.findAllByText(/Port must be an integer/, { selector: ".mcp-port-error" });
    expect(alerts).toHaveLength(1);
    expect(document.querySelectorAll(".mcp-port-error")).toHaveLength(1);
  });

  it("keeps a rejected port in the field and drops its message once the saved port is restored", async () => {
    vi.mocked(api.getMcpStatus).mockResolvedValue({ status: "port_in_use", message: "7373 is taken" });
    render(<SettingsView doc={mcpDoc} />);
    const note = await screen.findByText(/Port in use/, { selector: ".mcp-port-error" });
    const input = note.closest("label")!.querySelector("input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "80" } });
    fireEvent.blur(input);
    await screen.findByText(/Port must be an integer/, { selector: ".mcp-port-error" });
    expect(input.value).toBe("80");
    expect(document.querySelectorAll(".mcp-port-error")).toHaveLength(1);
    fireEvent.change(input, { target: { value: "7373" } });
    fireEvent.blur(input);
    await screen.findByText(/Port in use.*7373 is taken/, { selector: ".mcp-port-error" });
    expect(screen.queryByText(/Port must be an integer/)).toBeNull();
    expect(document.querySelectorAll(".mcp-port-error")).toHaveLength(1);
    expect(api.updateSettings).not.toHaveBeenCalled();
  });

  it.each(["1e4", "1.0", "+5000", "5000x", "0x1F90", " 80 "])(
    "rejects non-digit or out-of-range port input %j",
    async (value) => {
      vi.mocked(api.getMcpStatus).mockResolvedValue({ status: "listening" });
      render(<SettingsView doc={mcpDoc} />);
      const input = (await screen.findByDisplayValue("7373")) as HTMLInputElement;
      fireEvent.change(input, { target: { value } });
      fireEvent.blur(input);
      await screen.findByText(/Port must be an integer/);
      expect(api.updateSettings).not.toHaveBeenCalled();
    },
  );

  it("accepts a plain digit port", async () => {
    vi.mocked(api.getMcpStatus).mockResolvedValue({ status: "listening" });
    render(<SettingsView doc={mcpDoc} />);
    const input = (await screen.findByDisplayValue("7373")) as HTMLInputElement;
    fireEvent.change(input, { target: { value: " 5000 " } });
    fireEvent.blur(input);
    await waitFor(() => expect(api.updateSettings).toHaveBeenCalledWith({ mcp_port: 5000 }));
  });

  it("hides the MCP section on Android", async () => {
    vi.mocked(isAndroid).mockResolvedValue(true);
    render(<SettingsView doc={doc} />);
    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: /MCP server/i })).toBeNull();
    });
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
      folder_path: "/data/user/0/net.puetsua.pansuthong.dev/files",
      effective_path: "/data/user/0/net.puetsua.pansuthong.dev/files/tasks_device-abc.db",
    });

    render(<SettingsView doc={doc} />);

    await waitFor(() => expect(screen.getByText("Drive/Pansuthong")).toBeTruthy());
    expect(screen.getByText(/Synced folder:/i)).toBeTruthy();
    // Local app-data path must not appear once SAF is linked (one-folder UX).
    expect(screen.queryByText("/data/user/0/net.puetsua.pansuthong.dev/files")).toBeNull();
    expect(screen.getByRole("button", { name: /sync now/i })).toBeTruthy();
  });

  const openPickDialog = async () => {
    render(<SettingsView doc={doc} />);
    await waitFor(() => expect(screen.getByText("device-abc")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /choose folder/i }));
    return screen.findByRole("dialog");
  };

  it("asks keep-both for a folder without data; Cancel does not invoke", async () => {
    const dialog = await openPickDialog();
    expect(inspectDataFolder).toHaveBeenCalledWith("D:\\NewSync");
    expect(within(dialog).getByRole("heading", { name: /switch to the new folder/i })).toBeTruthy();
    expect(within(dialog).getByText(/other devices' files/i)).toBeTruthy();
    const actions = within(dialog).getAllByRole("button");
    expect(actions.map(b => b.textContent)).toEqual(["Cancel", "Remove from old", "Keep both"]);
    expect(document.activeElement?.textContent).toBe("Keep both");

    fireEvent.click(within(dialog).getByRole("button", { name: /cancel/i }));
    expect(setDataFolder).not.toHaveBeenCalled();
    expect(clearDataFolder).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it.each([
    ["Keep both", "copy"],
    ["Remove from old", "move"],
  ])("%s invokes setDataFolder with %s", async (label, mode) => {
    const dialog = await openPickDialog();
    fireEvent.click(within(dialog).getByRole("button", { name: label }));
    await waitFor(() => expect(setDataFolder).toHaveBeenCalledWith("D:\\NewSync", mode));
  });

  it("asks to merge for a folder that already has data", async () => {
    inspectDataFolder.mockResolvedValue({ has_data: true, is_current: false });
    const dialog = await openPickDialog();
    expect(
      within(dialog).getByRole("heading", { name: /already has pansuthong data/i }),
    ).toBeTruthy();
    const actions = within(dialog).getAllByRole("button");
    expect(actions.map(b => b.textContent)).toEqual(["Cancel", "Use folder's data", "Merge"]);
  });

  it.each([
    ["Merge", "merge"],
    ["Use folder's data", "adopt"],
  ])("%s invokes setDataFolder with %s", async (label, mode) => {
    inspectDataFolder.mockResolvedValue({ has_data: true, is_current: false });
    const dialog = await openPickDialog();
    fireEvent.click(within(dialog).getByRole("button", { name: label }));
    await waitFor(() => expect(setDataFolder).toHaveBeenCalledWith("D:\\NewSync", mode));
  });

  it("does nothing when the picked folder is the current one", async () => {
    inspectDataFolder.mockResolvedValue({ has_data: true, is_current: true });
    render(<SettingsView doc={doc} />);
    await waitFor(() => expect(screen.getByText("device-abc")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /choose folder/i }));
    await waitFor(() => expect(inspectDataFolder).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(setDataFolder).not.toHaveBeenCalled();
  });

  it("clears without a dialog when the custom folder is already the default one", async () => {
    inspectDataFolder.mockResolvedValue({ has_data: true, is_current: true });
    render(<SettingsView doc={doc} />);
    await waitFor(() => expect(screen.getByText("device-abc")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /use default/i }));
    await waitFor(() => expect(clearDataFolder).toHaveBeenCalledWith("merge"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows the inspection error and no dialog", async () => {
    inspectDataFolder.mockRejectedValue("boom");
    render(<SettingsView doc={doc} />);
    await waitFor(() => expect(screen.getByText("device-abc")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /choose folder/i }));
    await waitFor(() => expect(screen.getByText(/boom/)).toBeTruthy());
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(setDataFolder).not.toHaveBeenCalled();
  });

  it("inspects the default location for clear; Merge invokes clearDataFolder", async () => {
    inspectDataFolder.mockResolvedValue({ has_data: true, is_current: false });
    render(<SettingsView doc={doc} />);
    await waitFor(() => expect(screen.getByText("device-abc")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /use default/i }));
    const dialog = await screen.findByRole("dialog");
    expect(inspectDataFolder).toHaveBeenCalledWith(null);
    expect(clearDataFolder).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Merge" }));
    await waitFor(() => expect(clearDataFolder).toHaveBeenCalledWith("merge"));
  });
});
