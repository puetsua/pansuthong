import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// Drive the prompt through its module seam rather than the raw plugins.
vi.mock("../lib/updater", () => ({
  checkForUpdate: vi.fn(),
  installUpdate: vi.fn(),
}));

import { checkForUpdate, installUpdate } from "../lib/updater";
import { UpdatePrompt } from "./UpdatePrompt";
import type { Update } from "@tauri-apps/plugin-updater";

const checkMock = vi.mocked(checkForUpdate);
const installMock = vi.mocked(installUpdate);

const fakeUpdate = (over: Partial<Update> = {}) =>
  ({ version: "0.2.0", body: "## Fixed\n\n- A bug", ...over }) as Update;

beforeEach(() => {
  checkMock.mockReset();
  installMock.mockReset();
  installMock.mockResolvedValue(undefined);
});

describe("UpdatePrompt", () => {
  it("renders nothing when no update is available", async () => {
    checkMock.mockResolvedValue(null);
    render(<UpdatePrompt />);
    await waitFor(() => expect(checkMock).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows the version and release notes when an update is available", async () => {
    checkMock.mockResolvedValue(fakeUpdate());
    render(<UpdatePrompt />);
    const dialog = await screen.findByRole("dialog");
    expect(dialog.classList.contains("task-editor")).toBe(true);
    expect(dialog.classList.contains("upd-prompt")).toBe(true);
    expect(screen.getByText(/0\.2\.0/)).toBeTruthy();
    expect(screen.getByText("A bug")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
  });

  it("dismisses on 'Later' without installing", async () => {
    checkMock.mockResolvedValue(fakeUpdate());
    render(<UpdatePrompt />);
    fireEvent.click(await screen.findByText("Later"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(installMock).not.toHaveBeenCalled();
  });

  it("dismisses on Escape without installing", async () => {
    checkMock.mockResolvedValue(fakeUpdate());
    render(<UpdatePrompt />);
    await screen.findByRole("dialog");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(installMock).not.toHaveBeenCalled();
  });

  it("installs the update on 'Update now'", async () => {
    const update = fakeUpdate();
    checkMock.mockResolvedValue(update);
    // Keep the install pending so the dialog stays mounted to assert against.
    installMock.mockReturnValue(new Promise(() => {}));
    render(<UpdatePrompt />);
    fireEvent.click(await screen.findByText("Update now"));
    await waitFor(() => expect(installMock).toHaveBeenCalledWith(update, expect.any(Function)));
  });

  it("blocks Escape and Close while downloading", async () => {
    checkMock.mockResolvedValue(fakeUpdate());
    installMock.mockReturnValue(new Promise(() => {}));
    render(<UpdatePrompt />);
    fireEvent.click(await screen.findByText("Update now"));
    await waitFor(() => expect(screen.getByRole("status")).toBeTruthy());
    expect((screen.getByRole("button", { name: "Close" }) as HTMLButtonElement).disabled).toBe(true);
    const bubble = vi.fn();
    window.addEventListener("keydown", bubble);
    fireEvent.keyDown(window, { key: "Escape" });
    window.removeEventListener("keydown", bubble);
    expect(screen.getByRole("dialog")).toBeTruthy();
    // Capture handler must stopPropagation so stacked editors do not also close.
    expect(bubble).not.toHaveBeenCalled();
    // Status region is the download focus landing (tabIndex=0) for the Tab trap.
    expect(screen.getByRole("status").tabIndex).toBe(0);
  });
});
