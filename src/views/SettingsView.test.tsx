import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { Document } from "../lib/tauri";
import { SettingsView } from "./SettingsView";

vi.mock("../lib/platform", () => ({
  isAndroid: vi.fn().mockResolvedValue(false),
}));

vi.mock("../lib/tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/tauri")>();
  return {
    ...actual,
    api: {
      updateSettings: vi.fn().mockResolvedValue(undefined),
      getDataLocation: vi.fn().mockResolvedValue({
        folder: "C:\\Sync\\Pansutong",
        device_id: "device-abc",
        folder_path: "C:\\Sync\\Pansutong",
        effective_path: "C:\\Sync\\Pansutong\\tasks_device-abc.json",
      }),
      pickAndSetDataFolder: vi.fn(),
      clearDataFolder: vi.fn(),
      safStatus: vi.fn(),
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

beforeEach(() => vi.clearAllMocks());

describe("SettingsView data location", () => {
  it("shows the device id and folder path instead of the replica JSON path", async () => {
    render(<SettingsView doc={doc} />);

    await waitFor(() => expect(screen.getByText("device-abc")).toBeTruthy());
    expect(screen.getByText("C:\\Sync\\Pansutong")).toBeTruthy();
    expect(screen.queryByText("C:\\Sync\\Pansutong\\tasks_device-abc.json")).toBeNull();
  });
});
