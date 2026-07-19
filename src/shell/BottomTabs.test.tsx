import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { BottomTabs } from "./BottomTabs";
import { buildIndexes } from "../state/indexes";
import { Document, Tag, Task } from "../lib/tauri";

const task = (over: Partial<Task> & { id: string }): Task => ({
  title: over.id,
  notes: "",
  tag_ids: [],
  created_at: "2026-01-01T00:00:00+08:00",
  ...over,
});

const doc = (tasks: Task[], tags: Tag[] = []): Document => ({
  version: 2,
  last_modified: undefined,
  settings: { theme: "auto", sort_order: "priority" },
  tags,
  tasks,
  template_tasks: [],
});

const renderTabs = (tasks: Task[], tags: Tag[] = []) => {
  const d = doc(tasks, tags);
  return render(
    <MemoryRouter>
      <BottomTabs indexes={buildIndexes(d)} />
    </MemoryRouter>,
  );
};

describe("BottomTabs — badges", () => {
  it("shows a numeric Today badge and an Inbox presence dot when both have open work", () => {
    renderTabs([
      task({ id: "k_today", due_date: "2026-05-28" }),
      task({ id: "k_inbox_a" }),
      task({ id: "k_inbox_b" }),
      task({ id: "k_inbox_c" }),
    ]);

    const todayBadge = screen.getByTestId("today-badge");
    expect(todayBadge.textContent).toBe("1");
    expect(todayBadge.classList.contains("bottom-tab-badge-dot")).toBe(false);

    const inboxBadge = screen.getByTestId("inbox-badge");
    expect(inboxBadge.textContent).toBe("");
    expect(inboxBadge.classList.contains("bottom-tab-badge-dot")).toBe(true);
  });

  it("hides the Inbox badge when every inbox task is completed", () => {
    renderTabs([
      task({ id: "k_done", completed_at: "2026-05-28T10:00:00+08:00" }),
    ]);
    expect(screen.queryByTestId("inbox-badge")).toBeNull();
  });

  it("hides the Inbox badge when open tasks are only under a pinned tag", () => {
    renderTabs(
      [task({ id: "k_tagged", tag_ids: ["t_work"] })],
      [{ id: "t_work", name: "work", color: "#000", priority: 0, pinned: true }],
    );
    expect(screen.queryByTestId("inbox-badge")).toBeNull();
  });

  it("still treats unpinned-only tags as Inbox (dot, no number)", () => {
    renderTabs(
      [task({ id: "k_loose", tag_ids: ["t_loose"] })],
      [{ id: "t_loose", name: "loose", color: "#000", priority: 0, pinned: false }],
    );
    const inboxBadge = screen.getByTestId("inbox-badge");
    expect(inboxBadge.textContent).toBe("");
    expect(inboxBadge.classList.contains("bottom-tab-badge-dot")).toBe(true);
  });
});
