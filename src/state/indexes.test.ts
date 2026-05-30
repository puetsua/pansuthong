import { describe, expect, it } from "vitest";
import sample from "../tests/fixtures/sample.json";
import { Document, SortOrder, Task } from "../lib/tauri";
import { buildIndexes, effectivePriority } from "./indexes";

const TODAY = "2026-05-28";

describe("buildIndexes", () => {
  const ix = buildIndexes(sample as unknown as Document);

  it("today contains overdue + scheduled today + due today", () => {
    const ids = ix.today(TODAY).map(t => t.id);
    expect(ids).toEqual(["k_overdue1", "k_today1", "k_today2", "k_reno1"]);
  });

  it("inbox contains only untagged tasks", () => {
    expect(ix.inbox.map(t => t.id)).toEqual(["k_future1"]);
  });

  it("byTag for t_urgent returns one task", () => {
    expect(ix.byTag.get("t_urgent")?.map(t => t.id)).toEqual(["k_overdue1"]);
  });

  it("tagsByName maps lowercase name to tag", () => {
    expect(ix.tagsByName.get("work")?.id).toBe("t_work");
    expect(ix.tagsByName.get("WORK".toLowerCase())?.id).toBe("t_work");
  });

  it("tasks contains the full set in original order", () => {
    expect(ix.tasks.map(t => t.id)).toEqual([
      "k_overdue1", "k_today1", "k_today2", "k_reno1", "k_future1"
    ]);
  });
});

// All tasks are overdue (due < TODAY, not done) so they all land in today().
function task(id: string, tag_ids: string[], due_date: string): Task {
  return { id, title: id, done: false, due_date, notes: "", tag_ids, created_at: 0, updated_at: 0 };
}

function weightedDoc(order: SortOrder): Document {
  return {
    version: 2,
    last_modified: 0,
    settings: { theme: "auto", sort_order: order },
    tags: [
      { id: "t_hi",  name: "hi",  color: "#000", priority: 9 },
      { id: "t_lo",  name: "lo",  color: "#000", priority: 1 },
      { id: "t_neg", name: "neg", color: "#000", priority: -5 },
    ],
    tasks: [
      task("k_a", ["t_lo"],  "2026-05-20"), // weight 1
      task("k_b", ["t_hi"],  "2026-05-25"), // weight 9
      task("k_c", [],        "2026-05-10"), // weight 0 (untagged)
      task("k_d", ["t_neg"], "2026-05-15"), // weight -5
    ],
  };
}

describe("effectivePriority", () => {
  const ix = buildIndexes(weightedDoc("priority"));
  it("is the max weight among a task's tags (0 when untagged)", () => {
    const byId = new Map(ix.tasks.map(t => [t.id, t]));
    expect(effectivePriority(byId.get("k_b")!, ix.tagsById)).toBe(9);
    expect(effectivePriority(byId.get("k_a")!, ix.tagsById)).toBe(1);
    expect(effectivePriority(byId.get("k_c")!, ix.tagsById)).toBe(0);
    expect(effectivePriority(byId.get("k_d")!, ix.tagsById)).toBe(-5);
  });
});

describe("sort order", () => {
  it("priority mode: highest tag weight first (negative sinks below untagged)", () => {
    const ix = buildIndexes(weightedDoc("priority"));
    expect(ix.today("2026-05-28").map(t => t.id)).toEqual(["k_b", "k_a", "k_c", "k_d"]);
  });

  it("date mode: earliest date first, weight breaks ties", () => {
    const ix = buildIndexes(weightedDoc("date"));
    expect(ix.today("2026-05-28").map(t => t.id)).toEqual(["k_c", "k_d", "k_a", "k_b"]);
  });
});
