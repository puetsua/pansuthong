import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { GhostRow } from "./GhostRow";
import { GhostTask } from "../lib/recurrence";
import { Tag } from "../lib/tauri";

vi.mock("../lib/tauri", async orig => {
  const actual = await orig<typeof import("../lib/tauri")>();
  return {
    ...actual,
    api: {
      spawnRecurringTask: vi.fn().mockResolvedValue({
        id: "k_spawned",
        title: "Weekly review",
        notes: "",
        tag_ids: [],
        created_at: "2026-06-11T00:00:00+08:00",
      }),
      setTaskDone: vi.fn().mockResolvedValue({}),
    },
  };
});

vi.mock("../lib/sound", () => ({ playCompletionSound: vi.fn() }));

import { api } from "../lib/tauri";
import { playCompletionSound } from "../lib/sound";

const ghost: GhostTask = {
  id: "ghost_tpl1_2026-06-15",
  title: "Weekly review",
  notes: "",
  tag_ids: [],
  templateId: "tpl1",
  occurrenceDate: "2026-06-15",
};

const tags = new Map<string, Tag>();

beforeEach(() => vi.clearAllMocks());

describe("GhostRow (#184)", () => {
  it("notifies onCompleted after promoting and marking done", async () => {
    const onCompleted = vi.fn();
    render(<GhostRow ghost={ghost} tags={tags} onCompleted={onCompleted} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /complete/i }));
    await waitFor(() => expect(api.spawnRecurringTask).toHaveBeenCalledWith("tpl1", "2026-06-15"));
    await waitFor(() => expect(api.setTaskDone).toHaveBeenCalledWith("k_spawned", true));
    await waitFor(() => expect(onCompleted).toHaveBeenCalledWith("k_spawned"));
    expect(playCompletionSound).toHaveBeenCalledTimes(1);
  });
});
