import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { buildIndexes } from "../state/indexes";
import { Document, Tag } from "../lib/tauri";
import { appVersion } from "../lib/platform";
import { openUrl } from "@tauri-apps/plugin-opener";

// SyncStatus (rendered inside the sidebar) touches the tauri api; stub it out.
vi.mock("../lib/tauri", () => ({ api: { syncNow: vi.fn() } }));
// The footer version label reads the app version and opens the release page.
vi.mock("../lib/platform", () => ({ appVersion: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

const appVersionMock = vi.mocked(appVersion);
const openUrlMock = vi.mocked(openUrl);

beforeEach(() => {
  appVersionMock.mockReset();
  appVersionMock.mockResolvedValue(null); // hidden by default; tag-curation tests don't care
  openUrlMock.mockReset();
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
  it("places Search immediately below Upcoming, before Tags", () => {
    renderSidebar([]);
    const links = screen.getAllByRole("link").map(a => a.getAttribute("href"));
    const upcoming = links.indexOf("/upcoming");
    const search = links.indexOf("/search");
    const tags = links.indexOf("/tags");
    expect(upcoming).toBeGreaterThanOrEqual(0);
    expect(search).toBe(upcoming + 1);
    expect(tags).toBeGreaterThan(search);
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

describe("Sidebar — version label", () => {
  it("renders the running version and opens its release page on click", async () => {
    appVersionMock.mockResolvedValue("0.5.0");
    renderSidebar([]);

    const label = await screen.findByText("v0.5.0");
    fireEvent.click(label);
    expect(openUrlMock).toHaveBeenCalledWith(
      "https://github.com/puetsua/pansutong/releases/tag/0.5.0",
    );
  });

  it("omits the label when the version is unavailable", async () => {
    appVersionMock.mockResolvedValue(null);
    renderSidebar([]);

    await waitFor(() => expect(appVersionMock).toHaveBeenCalled());
    expect(screen.queryByText(/^v\d/)).toBeNull();
  });
});
