import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MobileHeader } from "./MobileHeader";
import { buildIndexes } from "../state/indexes";
import { Document } from "../lib/tauri";
import { appVersion } from "../lib/platform";
import { openUrl } from "@tauri-apps/plugin-opener";
import { onUpdatePromptRequested, setPendingUpdate, type AppUpdate } from "../lib/updater";

vi.mock("../lib/platform", () => ({ appVersion: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

const appVersionMock = vi.mocked(appVersion);
const openUrlMock = vi.mocked(openUrl);

beforeEach(() => {
  appVersionMock.mockReset();
  appVersionMock.mockResolvedValue(null);
  openUrlMock.mockReset();
  setPendingUpdate(null);
});

const doc = (): Document => ({
  version: 2,
  last_modified: undefined,
  settings: { theme: "auto", sort_order: "priority" },
  tags: [],
  tasks: [],
  template_tasks: [],
});

const renderHeader = () => {
  const d = doc();
  render(
    <MemoryRouter>
      <MobileHeader indexes={buildIndexes(d)} />
    </MemoryRouter>,
  );
};

const openMore = () => {
  fireEvent.click(screen.getByRole("button", { name: "More" }));
};

describe("MobileHeader — version label", () => {
  it("shows the running version in the More menu and opens its release page", async () => {
    appVersionMock.mockResolvedValue("0.5.0");
    renderHeader();
    expect(screen.queryByText("v0.5.0")).toBeNull();

    openMore();
    const label = await screen.findByText("v0.5.0");
    fireEvent.click(label);
    expect(openUrlMock).toHaveBeenCalledWith(
      "https://github.com/puetsua/pansuthong/releases/tag/0.5.0",
    );
  });

  it("omits the label when the version is unavailable", async () => {
    appVersionMock.mockResolvedValue(null);
    renderHeader();
    openMore();
    await waitFor(() => expect(appVersionMock).toHaveBeenCalled());
    expect(screen.queryByText(/^v\d/)).toBeNull();
  });

  it("still offers Update in the More menu when the version label is unavailable", async () => {
    appVersionMock.mockResolvedValue(null);
    renderHeader();
    openMore();
    await waitFor(() => expect(appVersionMock).toHaveBeenCalled());

    act(() => setPendingUpdate({ version: "0.6.0", downloadAndInstall: vi.fn() } satisfies AppUpdate));
    const requested = vi.fn();
    const off = onUpdatePromptRequested(requested);
    fireEvent.click(await screen.findByRole("button", { name: "Update" }));
    off();
    expect(requested).toHaveBeenCalledOnce();
    expect(screen.queryByText(/^v\d/)).toBeNull();
  });
});
