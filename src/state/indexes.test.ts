import { describe, expect, it } from "vitest";
import sample from "../tests/fixtures/sample.json";
import { Document, SortOrder, Task, TemplateTask } from "../lib/tauri";
import { buildIndexes, effectivePriority, openCount } from "./indexes";

const TODAY = "2026-05-28";

describe("buildIndexes", () => {
  const ix = buildIndexes(sample as unknown as Document);

  it("today contains overdue + scheduled today + due today", () => {
    const ids = ix.today(TODAY).map(t => t.id);
    expect(ids).toEqual(["k_overdue1", "k_today1", "k_today2", "k_reno1"]);
  });

  it("inbox contains tasks with no pinned tag (untagged or unpinned-only)", () => {
    // t_work and t_errand are pinned, so their tasks are surfaced in the sidebar
    // and excluded. k_reno1 (only the unpinned t_reno) and k_future1 (untagged)
    // have no pinned tag, so they fall to Inbox.
    expect(ix.inbox.map(t => t.id)).toEqual(["k_reno1", "k_future1"]);
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
  return { id, title: id, due_date, notes: "", tag_ids, created_at: "1970-01-01T00:00:00Z" };
}

function weightedDoc(order: SortOrder): Document {
  return {
    version: 2,
    last_modified: undefined,
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
    template_tasks: [],
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

  it("takes the MAX across multiple tags (not first/last/min/sum)", () => {
    const multi = task("k_multi", ["t_lo", "t_hi"], "2026-05-22"); // weights 1 and 9
    expect(effectivePriority(multi, ix.tagsById)).toBe(9);
    const multiNeg = task("k_multineg", ["t_neg", "t_lo"], "2026-05-22"); // -5 and 1
    expect(effectivePriority(multiNeg, ix.tagsById)).toBe(1);
  });

  it("ignores unknown tag ids (no phantom weight-0)", () => {
    // unknown-only resolves to no tags -> 0
    const unknownOnly = task("k_unk", ["t_does_not_exist"], "2026-05-22");
    expect(effectivePriority(unknownOnly, ix.tagsById)).toBe(0);
    // unknown + a real negative tag -> the negative value, not a phantom 0
    const unknownPlusNeg = task("k_unkneg", ["t_does_not_exist", "t_neg"], "2026-05-22"); // -5
    expect(effectivePriority(unknownPlusNeg, ix.tagsById)).toBe(-5);
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

// Tasks share dates/weights so the SECONDARY comparator and stable-sort fallback
// actually decide the order (the weightedDoc cases are all primary-key-distinct).
function tieDoc(order: SortOrder): Document {
  return {
    version: 2,
    last_modified: undefined,
    settings: { theme: "auto", sort_order: order },
    tags: [
      { id: "t_hi", name: "hi", color: "#000", priority: 9 },
      { id: "t_lo", name: "lo", color: "#000", priority: 1 },
      { id: "t_x",  name: "x",  color: "#000", priority: 5 },
    ],
    tasks: [
      task("k_lo", ["t_lo"], "2026-05-18"),     // same date as k_hi, lower weight
      task("k_hi", ["t_hi"], "2026-05-18"),     // same date as k_lo, higher weight
      task("k_first",  ["t_x"], "2026-05-19"),  // same date AND weight as k_second
      task("k_second", ["t_x"], "2026-05-19"),
    ],
    template_tasks: [],
  };
}

describe("sort tiebreaks", () => {
  it("date mode: equal dates fall back to weight desc", () => {
    const ix = buildIndexes(tieDoc("date"));
    const sameDay = ix.today("2026-05-28").filter(t => t.due_date === "2026-05-18").map(t => t.id);
    expect(sameDay).toEqual(["k_hi", "k_lo"]);
  });

  it("equal weight AND equal date preserve insertion order (stable sort)", () => {
    const ix = buildIndexes(tieDoc("priority"));
    const sameWeight = ix.today("2026-05-28").filter(t => t.due_date === "2026-05-19").map(t => t.id);
    expect(sameWeight).toEqual(["k_first", "k_second"]);
  });
});

// Done and open tasks all scheduled today, so today() includes every one.
function doneDoc(order: SortOrder): Document {
  const TODAY_ISO = "2026-05-28";
  const t = (id: string, tags: string[], done: boolean): Task => ({
    id, title: id, completed_at: done ? "2026-05-28T10:00:00Z" : undefined,
    scheduled_date: TODAY_ISO, notes: "", tag_ids: tags, created_at: "1970-01-01T00:00:00Z",
  });
  return {
    version: 2,
    last_modified: undefined,
    settings: { theme: "auto", sort_order: order },
    tags: [
      { id: "t_hi", name: "hi", color: "#000", priority: 9 },
      { id: "t_lo", name: "lo", color: "#000", priority: 1 },
    ],
    tasks: [
      t("k_done_hi", ["t_hi"], true),   // done,  weight 9
      t("k_open_lo", ["t_lo"], false),  // open,  weight 1
      t("k_open_hi", ["t_hi"], false),  // open,  weight 9
      t("k_done_lo", ["t_lo"], true),   // done,  weight 1
    ],
    template_tasks: [],
  };
}

describe("completed tasks leave the active lists (#32, #23)", () => {
  // Completing a task archives it (done == archived since the field merge), so it
  // drops out of Today and into `archived` rather than lingering de-emphasized in
  // the active list.
  it("priority mode: only open tasks remain, highest-weight first", () => {
    const ix = buildIndexes(doneDoc("priority"));
    expect(ix.today("2026-05-28").map(t => t.id)).toEqual(["k_open_hi", "k_open_lo"]);
  });

  it("the completed tasks move to the archived list", () => {
    const ix = buildIndexes(doneDoc("priority"));
    expect(new Set(ix.archived.map(t => t.id))).toEqual(new Set(["k_done_hi", "k_done_lo"]));
    expect(ix.today("2026-05-28").length).toBe(2);
  });

  it("openCount counts the remaining (all open) tasks", () => {
    const ix = buildIndexes(doneDoc("priority"));
    expect(openCount(ix.today("2026-05-28"))).toBe(2);
    expect(openCount([])).toBe(0);
  });
});

// One open tagged task plus two archived ones (a tagged + an untagged), all
// scheduled today so they'd otherwise land in the active lists.
function archivedDoc(): Document {
  const TODAY_ISO = "2026-05-28";
  const t = (id: string, tags: string[], archived: boolean, archived_at?: string): Task => ({
    id, title: id, scheduled_date: TODAY_ISO, notes: "",
    tag_ids: tags, created_at: "1970-01-01T00:00:00Z",
    completed_at: archived ? (archived_at ?? "2026-05-28T09:00:00Z") : undefined,
  });
  return {
    version: 2,
    last_modified: undefined,
    settings: { theme: "auto", sort_order: "priority" },
    // Pinned so the active k_open is surfaced via its tag view, keeping Inbox
    // empty — this test is about archived exclusion, not inbox membership.
    tags: [{ id: "t_w", name: "w", color: "#000", priority: 1, pinned: true }],
    tasks: [
      t("k_open",  ["t_w"], false),
      t("k_arch1", ["t_w"], true, "2026-05-28T10:00:00Z"),
      t("k_arch2", [],      true, "2026-05-28T11:00:00Z"),
    ],
    template_tasks: [],
  };
}

describe("archived tasks (#23)", () => {
  const ix = buildIndexes(archivedDoc());

  it("are excluded from today / inbox / byTag / tasks", () => {
    expect(ix.today("2026-05-28").map(t => t.id)).toEqual(["k_open"]);
    expect(ix.inbox.map(t => t.id)).toEqual([]);
    expect(ix.byTag.get("t_w")?.map(t => t.id)).toEqual(["k_open"]);
    expect(ix.tasks.map(t => t.id)).toEqual(["k_open"]);
  });

  it("are collected into `archived`, most-recently-archived first", () => {
    expect(ix.archived.map(t => t.id)).toEqual(["k_arch2", "k_arch1"]);
  });

  it("orders `archived` by instant, not lexically, across timezone offsets", () => {
    // Same completion times expressed in different local offsets, chosen so that a
    // lexical compare disagrees with chronological order: k_early's instant
    // (2026-06-01T14:00:00Z) precedes k_late's (2026-06-01T16:00:00Z), yet its
    // string sorts *after* lexically ("...T23..." > "...T16...").
    const t = (id: string, completed_at: string): Task => ({
      id, title: id, notes: "", tag_ids: [], created_at: "1970-01-01T00:00:00Z", completed_at,
    });
    const doc: Document = {
      version: 2, last_modified: undefined,
      settings: { theme: "auto", sort_order: "priority" }, tags: [],
      tasks: [
        t("k_early", "2026-06-01T23:00:00+09:00"),
        t("k_late",  "2026-06-01T16:00:00+00:00"),
      ],
      template_tasks: [],
    };
    expect(buildIndexes(doc).archived.map(x => x.id)).toEqual(["k_late", "k_early"]);
  });
});

// A real task plus two templates (a tagged one + an untagged one). Templates live
// in their own list, so they can never reach the active lists regardless.
function templatesDoc(): Document {
  const TODAY_ISO = "2026-05-28";
  const tmpl = (id: string, tags: string[]): TemplateTask => ({
    id, title: id, notes: "", tag_ids: tags, created_at: "1970-01-01T00:00:00Z",
  });
  return {
    version: 5,
    last_modified: undefined,
    settings: { theme: "auto", sort_order: "priority" },
    // Pinned so the active k_real is surfaced via its tag view, keeping Inbox
    // empty — this test is about template exclusion, not inbox membership.
    tags: [{ id: "t_w", name: "w", color: "#000", priority: 1, pinned: true }],
    tasks: [
      { id: "k_real", title: "k_real", scheduled_date: TODAY_ISO, notes: "",
        tag_ids: ["t_w"], created_at: "1970-01-01T00:00:00Z" },
    ],
    template_tasks: [
      tmpl("k_tmpl",       ["t_w"]),
      tmpl("k_tmpl_inbox", []),
    ],
  };
}

describe("templates (#71)", () => {
  const ix = buildIndexes(templatesDoc());

  it("are not part of today / inbox / byTag / tasks", () => {
    expect(ix.today("2026-05-28").map(t => t.id)).toEqual(["k_real"]);
    expect(ix.inbox.map(t => t.id)).toEqual([]);
    expect(ix.byTag.get("t_w")?.map(t => t.id)).toEqual(["k_real"]);
    expect(ix.tasks.map(t => t.id)).toEqual(["k_real"]);
  });

  it("are collected into `templates` in document order", () => {
    expect(ix.templates.map(t => t.id)).toEqual(["k_tmpl", "k_tmpl_inbox"]);
  });
});
