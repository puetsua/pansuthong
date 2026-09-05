import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { buildIndexes } from "../state/indexes";
import { Document, Tag } from "../lib/tauri";
import { appVersion } from "../lib/platform";
import { openUrl } from "@tauri-apps/plugin-opener";
import { onUpdatePromptRequested, setPendingUpdate, type AppUpdate } from "../lib/updater";

vi.mock("../lib/tauri", async orig => {
  const actual = await orig<typeof import("../lib/tauri")>();
  const stubTag = (id: string): Tag => ({ id, name: id, color: "#000", priority: 0 });
  return {
    ...actual,
    api: {
      ...actual.api,
      updateTag: vi.fn(async (input: { id: string }) => stubTag(input.id)),
    },
  };
});

import { api } from "../lib/tauri";

// The footer version label reads the app version and opens the release page.
// This mock also stands in front of the `isAndroid` that `lib/updater` imports
// from the same module, and does not provide it — fine only because Sidebar
// never calls `checkForUpdate`; add it here if that ever changes.
vi.mock("../lib/platform", () => ({ appVersion: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

const appVersionMock = vi.mocked(appVersion);
const openUrlMock = vi.mocked(openUrl);

beforeEach(() => {
  appVersionMock.mockReset();
  appVersionMock.mockResolvedValue(null); // hidden by default; tag-curation tests don't care
  openUrlMock.mockReset();
  setPendingUpdate(null); // module-level store; must not leak between tests
});

const tag = (over: Partial<Tag>): Tag => ({
  id: "t_x", name: "x", color: "#000", priority: 0, ...over,
});

const doc = (tags: Tag[]): Document => ({
  version: 2,
  last_modified: undefined,
  settings: { theme: "auto", sort_order: "priority" },
  tags,
  tasks: [],
  template_tasks: [],
});

const renderSidebar = (tags: Tag[]) => {
  const d = doc(tags);
  render(
    <MemoryRouter>
      <Sidebar doc={d} indexes={buildIndexes(d)} />
    </MemoryRouter>,
  );
};

describe("Sidebar — primary nav order", () => {
  it("places Search immediately below Calendar, before Tags", () => {
    renderSidebar([]);
    const links = screen.getAllByRole("link").map(a => a.getAttribute("href"));
    const upcoming = links.indexOf("/upcoming");
    const calendar = links.indexOf("/calendar");
    const search = links.indexOf("/search");
    const tags = links.indexOf("/tags");
    expect(upcoming).toBeGreaterThanOrEqual(0);
    expect(calendar).toBe(upcoming + 1);
    expect(search).toBe(calendar + 1);
    expect(tags).toBeGreaterThan(search);
  });

  it("keeps primary nav text-only (icons belong on mobile bottom tabs)", () => {
    renderSidebar([]);
    for (const name of [/today/i, /inbox/i, /upcoming/i, /calendar/i]) {
      const link = screen.getByRole("link", { name });
      expect(link.querySelector("svg")).toBeNull();
    }
  });

  it("does not show a numeric count on Inbox (presence is the mobile badge only)", () => {
    const d: Document = {
      version: 2,
      last_modified: undefined,
      settings: { theme: "auto", sort_order: "priority" },
      tags: [],
      tasks: [{
        id: "k_inbox",
        title: "loose",
        notes: "",
        tag_ids: [],
        created_at: "2026-01-01T00:00:00+08:00",
      }],
      template_tasks: [],
    };
    render(
      <MemoryRouter>
        <Sidebar doc={d} indexes={buildIndexes(d)} />
      </MemoryRouter>,
    );
    const inbox = screen.getByRole("link", { name: /inbox/i });
    expect(inbox.textContent?.replace(/\s+/g, " ").trim()).toMatch(/^inbox$/i);
  });
});

describe("Sidebar — tag curation (#78)", () => {
  it("lists only pinned tags, hiding the rest", () => {
    renderSidebar([
      tag({ id: "t_pin", name: "work", pinned: true }),
      tag({ id: "t_hidden", name: "someday", pinned: false }),
      tag({ id: "t_legacy", name: "legacy" }), // pinned absent => hidden
    ]);

    // The name renders plain; the colored "#" is a separate decorative glyph (#68).
    expect(screen.getByText("work")).toBeTruthy();
    expect(screen.queryByText("someday")).toBeNull();
    expect(screen.queryByText("legacy")).toBeNull();
  });

  it("shows a manage-tags hint when nothing is pinned", () => {
    renderSidebar([tag({ id: "t_a", name: "a" }), tag({ id: "t_b", name: "b" })]);

    expect(screen.getByText(/No pinned tags/i)).toBeTruthy();
    const manage = screen.getByRole("link", { name: /manage tags/i });
    expect(manage.getAttribute("href")).toBe("/tags");
  });
});

describe("Sidebar — dashboard pin (#201)", () => {
  beforeEach(() => {
    vi.mocked(api.updateTag).mockClear();
    vi.mocked(api.updateTag).mockImplementation(async input =>
      tag({ id: input.id, name: input.id }),
    );
  });

  it("pins an unpinned tag from the context menu", () => {
    renderSidebar([tag({ id: "t_pin", name: "work", pinned: true })]);

    fireEvent.contextMenu(screen.getByText("work"));
    fireEvent.click(screen.getByRole("menuitem", { name: /add to dashboard/i }));

    expect(api.updateTag).toHaveBeenCalledWith({ id: "t_pin", dashboard_view: "heatmap" });
  });

  it("does not open a context menu for tags already on the dashboard", () => {
    renderSidebar([
      tag({ id: "t_pin", name: "work", pinned: true, dashboard_view: "heatmap" }),
    ]);

    fireEvent.contextMenu(screen.getByText("work"));
    expect(screen.queryByRole("menuitem", { name: /add to dashboard/i })).toBeNull();
  });
});

describe("Sidebar — version label", () => {
  it("renders the running version and opens its release page on click", async () => {
    appVersionMock.mockResolvedValue("0.5.0");
    renderSidebar([]);

    const label = await screen.findByText("v0.5.0");
    fireEvent.click(label);
    expect(openUrlMock).toHaveBeenCalledWith(
      "https://github.com/puetsua/pansuthong/releases/tag/0.5.0",
    );
  });

  it("omits the label when the version is unavailable", async () => {
    appVersionMock.mockResolvedValue(null);
    renderSidebar([]);

    await waitFor(() => expect(appVersionMock).toHaveBeenCalled());
    expect(screen.queryByText(/^v\d/)).toBeNull();
  });
});

// The Update button beside the version: only present while an update is pending.
// UpdatePrompt is not mounted here, so these assert that the request fires; the
// reopen it causes is covered in `UpdatePrompt.test.tsx`.
describe("Sidebar — update button", () => {
  it("stays hidden when no update is pending", async () => {
    appVersionMock.mockResolvedValue("0.5.0");
    renderSidebar([]);

    await screen.findByText("v0.5.0");
    expect(screen.queryByRole("button", { name: "Update" })).toBeNull();
  });

  it("appears once an update is published and requests the prompt on click", async () => {
    appVersionMock.mockResolvedValue("0.5.0");
    renderSidebar([]);
    await screen.findByText("v0.5.0");

    const requested = vi.fn();
    const off = onUpdatePromptRequested(requested);
    act(() => setPendingUpdate({ version: "0.6.0", downloadAndInstall: vi.fn() } satisfies AppUpdate));

    fireEvent.click(await screen.findByRole("button", { name: "Update" }));
    off();
    expect(requested).toHaveBeenCalledOnce();
  });

  it("still shows when the version label is unavailable", async () => {
    // appVersion() swallows its errors and returns null; that must not take the
    // update entry point down with it.
    appVersionMock.mockResolvedValue(null);
    renderSidebar([]);
    await waitFor(() => expect(appVersionMock).toHaveBeenCalled());

    act(() => setPendingUpdate({ version: "0.6.0", downloadAndInstall: vi.fn() } satisfies AppUpdate));
    expect(screen.getByRole("button", { name: "Update" })).toBeTruthy();
    expect(screen.queryByText(/^v\d/)).toBeNull(); // label still absent
  });

  it("hides itself again when the pending update is cleared", async () => {
    appVersionMock.mockResolvedValue("0.5.0");
    renderSidebar([]);
    await screen.findByText("v0.5.0");

    act(() => setPendingUpdate({ version: "0.6.0", downloadAndInstall: vi.fn() } satisfies AppUpdate));
    await screen.findByRole("button", { name: "Update" });

    act(() => setPendingUpdate(null));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Update" })).toBeNull());
  });
});
