import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

// Drive the prompt through its module seam rather than the raw plugins. The
// pending-update store and its request event stay real, so the request path runs
// against the real store; the Sidebar half is covered in `Sidebar.test.tsx`.
vi.mock("../lib/updater", async importOriginal => {
  const actual = await importOriginal<typeof import("../lib/updater")>();
  return {
    ...actual,
    checkForUpdate: vi.fn(),
    installUpdate: vi.fn(),
  };
});

import {
  checkForUpdate,
  getPendingUpdate,
  installUpdate,
  requestUpdatePrompt,
  setPendingUpdate,
} from "../lib/updater";
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
  setPendingUpdate(null); // module-level store; must not leak between tests
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

  it("installs the update on 'Update'", async () => {
    const update = fakeUpdate();
    checkMock.mockResolvedValue(update);
    // Keep the install pending so the dialog stays mounted to assert against.
    installMock.mockReturnValue(new Promise(() => {}));
    render(<UpdatePrompt />);
    fireEvent.click(await screen.findByText("Update"));
    await waitFor(() => expect(installMock).toHaveBeenCalledWith(update, expect.any(Function)));
  });

  it("blocks Escape and Close while downloading", async () => {
    checkMock.mockResolvedValue(fakeUpdate());
    installMock.mockReturnValue(new Promise(() => {}));
    render(<UpdatePrompt />);
    fireEvent.click(await screen.findByText("Update"));
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

// Reopening from the sidebar's Update button, which only exists because the
// startup check published the update it found.
describe("UpdatePrompt pending update", () => {
  it("publishes the found update so the sidebar can offer it", async () => {
    const update = fakeUpdate();
    checkMock.mockResolvedValue(update);
    render(<UpdatePrompt />);
    await screen.findByRole("dialog");
    expect(getPendingUpdate()).toBe(update);
  });

  it("publishes nothing when there is no update", async () => {
    checkMock.mockResolvedValue(null);
    render(<UpdatePrompt />);
    await waitFor(() => expect(checkMock).toHaveBeenCalled());
    expect(getPendingUpdate()).toBeNull();
  });

  it("reopens on request after 'Later', without re-checking", async () => {
    checkMock.mockResolvedValue(fakeUpdate());
    render(<UpdatePrompt />);
    fireEvent.click(await screen.findByText("Later"));
    expect(screen.queryByRole("dialog")).toBeNull();

    act(() => requestUpdatePrompt());
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText(/0\.2\.0/)).toBeTruthy();
    expect(checkMock).toHaveBeenCalledTimes(1); // reused, not re-fetched
  });

  it("ignores the request when nothing is pending", async () => {
    checkMock.mockResolvedValue(null);
    render(<UpdatePrompt />);
    await waitFor(() => expect(checkMock).toHaveBeenCalled());

    act(() => requestUpdatePrompt());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("restores focus to the reopening trigger, not the first opener", async () => {
    // Each open must re-capture its own opener; otherwise dismissing a reopened
    // dialog throws focus back to whatever was active during the startup check.
    checkMock.mockResolvedValue(fakeUpdate());
    render(<UpdatePrompt />);
    fireEvent.click(await screen.findByText("Later"));

    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    act(() => requestUpdatePrompt());
    fireEvent.click(screen.getByText("Later"));
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it("does not reopen over an already-visible prompt", async () => {
    checkMock.mockResolvedValue(fakeUpdate());
    installMock.mockReturnValue(new Promise(() => {}));
    render(<UpdatePrompt />);
    fireEvent.click(await screen.findByText("Update"));
    await waitFor(() => expect(screen.getByRole("status")).toBeTruthy());

    act(() => requestUpdatePrompt()); // must not drop back to the offer
    expect(screen.getByRole("status")).toBeTruthy();
  });
});
