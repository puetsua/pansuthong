import { describe, expect, it } from "vitest";
import sample from "../tests/fixtures/sample.json";
import { Document, SortOrder, Task, TemplateTask } from "../lib/tauri";
import { buildIndexes, effectivePriority, openCount } from "./indexes";

const TODAY = "2026-05-28";
const sampleDoc = {
  ...sample,
  settings: { theme: "auto", sort_order: "priority" as SortOrder },
} as unknown as Document;

describe("buildIndexes", () => {
  const ix = buildIndexes(sampleDoc);

  it("today contains overdue + scheduled today + due today", () => {
    const ids = ix.today(TODAY).map(t => t.id);
    expect(ids).toEqual(["k_overdue1", "k_today1", "k_today2", "k_reno1"]);
  });

  it("today includes any task whose start_date is on or before today (open-ended or within span)", () => {
    const spanning = doc({
      tags: [],
      tasks: [
        { id: "k_span", title: "k_span", notes: "", tag_ids: [], created_at: "1970-01-01T00:00:00Z",
          start_date: "2026-05-20", due_date: "2026-06-05" }, // 05-28 is within the span
        { id: "k_open_ended", title: "k_open_ended", notes: "", tag_ids: [], created_at: "1970-01-01T00:00:00Z",
          start_date: "2026-05-20" }, // start-only, before today: runs open-endedly forward, included
        { id: "k_future_span", title: "k_future_span", notes: "", tag_ids: [], created_at: "1970-01-01T00:00:00Z",
          start_date: "2026-05-29", due_date: "2026-06-05" }, // starts tomorrow: excluded
        { id: "k_future_start", title: "k_future_start", notes: "", tag_ids: [], created_at: "1970-01-01T00:00:00Z",
          start_date: "2026-05-29" }, // start-only in the future: excluded until it begins
      ],
    });
    expect(buildIndexes(spanning).today(TODAY).map(t => t.id)).toEqual(["k_span", "k_open_ended"]);
  });

  it("inbox contains tasks with no pinned tag (untagged or unpinned-only)", () => {
    // t_work and t_errand are pinned, so their tasks are surfaced in the sidebar
    // and excluded. k_reno1 (only the unpinned t_reno) and k_future1 (untagged)
    // have no pinned tag, so they fall to Inbox. Under the default priority sort,
    // untagged k_future1 (weight 0) ranks above k_reno1, whose t_reno weight of
    // -1 sinks it below untagged tasks.
    expect(ix.inbox.map(t => t.id)).toEqual(["k_future1", "k_reno1"]);
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
    start_date: TODAY_ISO, notes: "", tag_ids: tags, created_at: "1970-01-01T00:00:00Z",
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

describe("completed-today tasks linger in Today, at the bottom (#recover)", () => {
  // Completing a task archives it, but in Today it stays until the day rolls over —
  // de-emphasised and sorted below the open tasks — so a mis-click can be undone.
  it("priority mode: open tasks first (by weight), then today's completions", () => {
    const ix = buildIndexes(doneDoc("priority"));
    expect(ix.today("2026-05-28").map(t => t.id))
      .toEqual(["k_open_hi", "k_open_lo", "k_done_hi", "k_done_lo"]);
  });

  it("the completed tasks are also in the archived list", () => {
    const ix = buildIndexes(doneDoc("priority"));
    expect(new Set(ix.archived.map(t => t.id))).toEqual(new Set(["k_done_hi", "k_done_lo"]));
    expect(ix.today("2026-05-28").length).toBe(4);
  });

  it("openCount counts only the open tasks, not the lingering completions", () => {
    const ix = buildIndexes(doneDoc("priority"));
    expect(openCount(ix.today("2026-05-28"))).toBe(2);
    expect(openCount([])).toBe(0);
  });

  it("a completion from an earlier day is gone; today's lingers at the bottom", () => {
    const mk = (id: string, completed_at?: string): Task => ({
      id, title: id, start_date: "2026-05-28", notes: "", tag_ids: [],
      created_at: "1970-01-01T00:00:00Z", completed_at,
    });
    const doc: Document = {
      version: 2, last_modified: undefined,
      settings: { theme: "auto", sort_order: "priority" }, tags: [],
      tasks: [
        mk("k_open"),
        mk("k_done_today", "2026-05-28T10:00:00Z"),
        mk("k_done_yesterday", "2026-05-27T10:00:00Z"),
      ],
      template_tasks: [],
    };
    expect(buildIndexes(doc).today("2026-05-28").map(t => t.id))
      .toEqual(["k_open", "k_done_today"]);
  });

  it("a task completed before the day-start hour lingers in the prior logical day (#109)", () => {
    // Day starts at 3am. A task finished at 00:05 on 06-11 still belongs to the
    // 06-10 logical day, so it must linger in that day's Today, not vanish.
    const mk = (id: string, completed_at?: string): Task => ({
      id, title: id, start_date: "2026-06-10", notes: "", tag_ids: [],
      created_at: "1970-01-01T00:00:00+08:00", completed_at,
    });
    const doc: Document = {
      version: 2, last_modified: undefined,
      settings: { theme: "auto", sort_order: "priority", day_start_hour: 3 }, tags: [],
      tasks: [
        mk("k_open"),
        mk("k_after_midnight", "2026-06-11T00:05:00+08:00"),
      ],
      template_tasks: [],
    };
    const ix = buildIndexes(doc);
    // It lingers in the logical day it belongs to (06-10), not the wall date (06-11).
    expect(ix.today("2026-06-10").map(t => t.id)).toEqual(["k_open", "k_after_midnight"]);
    // On 06-11 the done task is gone (it belongs to 06-10), but the still-open
    // k_open carries forward — its open-ended start span covers every later day.
    expect(ix.today("2026-06-11").map(t => t.id)).toEqual(["k_open"]);
    // And it is reachable in the archive (completion = archival here).
    expect(ix.archived.map(t => t.id)).toEqual(["k_after_midnight"]);
  });
});

// One open tagged task plus two archived ones (a tagged + an untagged), all
// scheduled today so they'd otherwise land in the active lists. The archived ones
// were completed on a PRIOR day, so they don't linger in Today (#recover) and the
// exclusion under test is purely about being archived.
function archivedDoc(): Document {
  const TODAY_ISO = "2026-05-28";
  const t = (id: string, tags: string[], archived: boolean, archived_at?: string): Task => ({
    id, title: id, start_date: TODAY_ISO, notes: "",
    tag_ids: tags, created_at: "1970-01-01T00:00:00Z",
    completed_at: archived ? (archived_at ?? "2026-05-27T09:00:00Z") : undefined,
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
      t("k_arch1", ["t_w"], true, "2026-05-27T10:00:00Z"),
      t("k_arch2", [],      true, "2026-05-27T11:00:00Z"),
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
      { id: "k_real", title: "k_real", start_date: TODAY_ISO, notes: "",
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

// A date-less task carrying time entries, so only tracking can pull it into Today.
describe("time-tracked tasks appear in Today independent of dates", () => {
  const TODAY_ISO = "2026-05-28";
  const mk = (id: string, entries: { start: string; end?: string }[]): Task => ({
    id, title: id, notes: "", tag_ids: [], created_at: "1970-01-01T00:00:00+00:00",
    time_entries: entries.map((e, i) => ({ id: `${id}_e${i}`, ...e })),
  });
  const withTasks = (tasks: Task[]): Document => doc({
    settings: { theme: "auto", sort_order: "priority" }, tasks,
  });

  it("a running timer surfaces an undated task in Today", () => {
    // Open entry (no end) => the timer is running now; no start/due date otherwise.
    const ix = buildIndexes(withTasks([mk("k_run", [{ start: "2026-05-28T09:00:00+00:00" }])]));
    expect(ix.today(TODAY_ISO).map(t => t.id)).toEqual(["k_run"]);
  });

  it("a task tracked-then-stopped today stays; a prior-day-only entry does not", () => {
    const ix = buildIndexes(withTasks([
      mk("k_stopped_today", [{ start: "2026-05-28T08:00:00+00:00", end: "2026-05-28T08:30:00+00:00" }]),
      mk("k_yesterday",     [{ start: "2026-05-27T08:00:00+00:00", end: "2026-05-27T08:30:00+00:00" }]),
    ]));
    expect(ix.today(TODAY_ISO).map(t => t.id)).toEqual(["k_stopped_today"]);
  });

  it("an entry ending today (started yesterday) keeps the task in Today", () => {
    const ix = buildIndexes(withTasks([
      mk("k_overnight", [{ start: "2026-05-27T23:30:00+00:00", end: "2026-05-28T00:10:00+00:00" }]),
    ]));
    expect(ix.today(TODAY_ISO).map(t => t.id)).toEqual(["k_overnight"]);
  });

  it("attributes an entry to the logical day, honoring day_start_hour (#109)", () => {
    // Day starts at 3am. An entry at 00:15 on 06-11 belongs to the 06-10 logical day,
    // so it surfaces in 06-10's Today and is absent from 06-11's (rollover drop).
    const d: Document = {
      version: 2, last_modified: undefined,
      settings: { theme: "auto", sort_order: "priority", day_start_hour: 3 }, tags: [],
      tasks: [mk("k_after_midnight", [{ start: "2026-06-11T00:15:00+08:00", end: "2026-06-11T00:45:00+08:00" }])],
      template_tasks: [],
    };
    const ix = buildIndexes(d);
    expect(ix.today("2026-06-10").map(t => t.id)).toEqual(["k_after_midnight"]);
    expect(ix.today("2026-06-11").map(t => t.id)).toEqual([]);
  });

  it("does not resurface a completed (archived) task tracked on a prior day", () => {
    // Completion is unchanged: a done task tracked yesterday stays out of Today.
    const done = mk("k_done", [{ start: "2026-05-27T08:00:00+00:00", end: "2026-05-27T08:30:00+00:00" }]);
    done.completed_at = "2026-05-27T09:00:00+00:00";
    const ix = buildIndexes(withTasks([done]));
    expect(ix.today(TODAY_ISO).map(t => t.id)).toEqual([]);
    expect(ix.archived.map(t => t.id)).toEqual(["k_done"]);
  });

  it("a track-only task completed today lingers until day rollover (#142)", () => {
    // Undated task: open membership was via today's tracking alone. Completing it
    // must not drop it from Today mid-day — same linger rule as date-scheduled work.
    const done = mk("k_track_done", [
      { start: "2026-05-28T09:00:00+00:00", end: "2026-05-28T09:30:00+00:00" },
    ]);
    done.completed_at = "2026-05-28T09:30:00+00:00";
    const ix = buildIndexes(withTasks([done]));
    expect(ix.today(TODAY_ISO).map(t => t.id)).toEqual(["k_track_done"]);
    expect(ix.archived.map(t => t.id)).toEqual(["k_track_done"]);
  });

  it("a running-timer task completed today still lingers (#142)", () => {
    // Completing stops the timer and closes the entry; lingering must still use
    // trackedToday so the row does not vanish the instant the checkbox is hit.
    const done = mk("k_was_running", [
      { start: "2026-05-28T09:00:00+00:00", end: "2026-05-28T09:15:00+00:00" },
    ]);
    done.completed_at = "2026-05-28T09:15:00+00:00";
    expect(buildIndexes(withTasks([done])).today(TODAY_ISO).map(t => t.id))
      .toEqual(["k_was_running"]);
  });
});

function doc(over: Partial<Document>): Document {
  return {
    version: 7,
    settings: { theme: "auto", sort_order: "priority" },
    tags: [],
    tasks: [],
    template_tasks: [],
    ...over,
  } as Document;
}

const TAG = { id: "t_ex", name: "exercise", color: "#000", priority: 0 };

describe("ghostsForDate", () => {
  it("emits a ghost for a recurring template that fires that day", () => {
    const d = doc({
      tags: [TAG],
      template_tasks: [{
        id: "k_t", title: "Push-ups", notes: "", tag_ids: ["t_ex"], created_at: "",
        due_offset_days: 3,
        recurrence: { kind: "weekly", weekdays: [1] }, recurrence_tag_id: "t_ex", // Monday
      }],
    });
    const ix = buildIndexes(d);
    const mon = ix.ghostsForDate("2026-06-08"); // Monday
    expect(mon.map(g => g.title)).toEqual(["Push-ups"]);
    expect(mon[0].templateId).toBe("k_t");
    expect(mon[0].occurrenceDate).toBe("2026-06-08");
    expect(mon[0].due_date).toBe("2026-06-11");
    expect(ix.ghostsForDate("2026-06-09")).toEqual([]); // Tuesday: no occurrence
  });

  it("does not emit a ghost for a tagless recurring template", () => {
    const d = doc({
      template_tasks: [{
        id: "k_t", title: "No tag", notes: "", tag_ids: [], created_at: "",
        recurrence: { kind: "weekly", weekdays: [1] },
      }],
    });
    expect(buildIndexes(d).ghostsForDate("2026-06-08")).toEqual([]);
  });

  it("suppresses the ghost when a same-tag task starts that day", () => {
    const d = doc({
      tags: [TAG],
      tasks: [{
        id: "k_done", title: "Push-ups", notes: "", tag_ids: ["t_ex"],
        created_at: "", start_date: "2026-06-08",
      }],
      template_tasks: [{
        id: "k_t", title: "Push-ups", notes: "", tag_ids: ["t_ex"], created_at: "",
        recurrence: { kind: "weekly", weekdays: [1] }, recurrence_tag_id: "t_ex",
      }],
    });
    expect(buildIndexes(d).ghostsForDate("2026-06-08")).toEqual([]);
  });

  it("a same-tag task merely DUE (not started) that day does NOT suppress the ghost", () => {
    // Suppression keys on start_date (a promoted occurrence is stamped start_date =
    // occurrence date); a task only due that day is unrelated and must not hide it.
    const d = doc({
      tags: [TAG],
      tasks: [{
        id: "k_due", title: "Push-ups", notes: "", tag_ids: ["t_ex"],
        created_at: "", due_date: "2026-06-08",
      }],
      template_tasks: [{
        id: "k_t", title: "Push-ups", notes: "", tag_ids: ["t_ex"], created_at: "",
        recurrence: { kind: "weekly", weekdays: [1] }, recurrence_tag_id: "t_ex",
      }],
    });
    expect(buildIndexes(d).ghostsForDate("2026-06-08").map(g => g.title)).toEqual(["Push-ups"]);
  });

  it("a completed same-tag task still suppresses the ghost (check-off flow)", () => {
    const d = doc({
      tags: [TAG],
      tasks: [{
        id: "k_done", title: "Push-ups", notes: "", tag_ids: ["t_ex"],
        created_at: "", start_date: "2026-06-08", completed_at: "2026-06-08T07:00:00+00:00",
      }],
      template_tasks: [{
        id: "k_t", title: "Push-ups", notes: "", tag_ids: ["t_ex"], created_at: "",
        recurrence: { kind: "weekly", weekdays: [1] }, recurrence_tag_id: "t_ex",
      }],
    });
    // The promoted-then-completed task is done, but suppression scans all tasks
    // (not just active ones), so the ghost must NOT reappear the same day.
    expect(buildIndexes(d).ghostsForDate("2026-06-08")).toEqual([]);
  });

  it("same-tag templates are alternatives: one started task clears both ghosts", () => {
    const d = doc({
      tags: [TAG],
      tasks: [{
        id: "k_done", title: "Push-ups", notes: "", tag_ids: ["t_ex"],
        created_at: "", start_date: "2026-06-08",
      }],
      template_tasks: [
        { id: "k_p", title: "Push-ups", notes: "", tag_ids: ["t_ex"], created_at: "",
          recurrence: { kind: "weekly", weekdays: [1] }, recurrence_tag_id: "t_ex" },
        { id: "k_s", title: "Sit-ups", notes: "", tag_ids: ["t_ex"], created_at: "",
          recurrence: { kind: "weekly", weekdays: [1] }, recurrence_tag_id: "t_ex" },
      ],
    });
    expect(buildIndexes(d).ghostsForDate("2026-06-08")).toEqual([]);
  });

  it("only the recurrence tag suppresses — other template tags don't", () => {
    const HEALTH = { id: "t_health", name: "health", color: "#0a0", priority: 0 };
    const d = doc({
      tags: [TAG, HEALTH],
      tasks: [{
        id: "k_other", title: "Checkup", notes: "", tag_ids: ["t_health"],
        created_at: "", start_date: "2026-06-08",
      }],
      template_tasks: [{
        id: "k_t", title: "Push-ups", notes: "", tag_ids: ["t_ex", "t_health"], created_at: "",
        recurrence: { kind: "weekly", weekdays: [1] }, recurrence_tag_id: "t_ex",
      }],
    });
    // A task starting that day carries 'health' (a template tag) but NOT the
    // recurrence tag 'exercise', so the ghost is NOT suppressed.
    expect(buildIndexes(d).ghostsForDate("2026-06-08").map(g => g.title)).toEqual(["Push-ups"]);
  });
});

// Weighted tags + a daily recurring template tagged "mid", so its ghost has a
// weight (5) that sits between the two real tasks (9 and 1).
const WEIGHTED_TAGS = [
  { id: "t_hi", name: "hi", color: "#000", priority: 9 },
  { id: "t_mid", name: "mid", color: "#000", priority: 5 },
  { id: "t_lo", name: "lo", color: "#000", priority: 1 },
];
const ISO = "2026-06-08";
function recurMergeDoc(order: SortOrder): Document {
  return doc({
    settings: { theme: "auto", sort_order: order },
    tags: WEIGHTED_TAGS,
    tasks: [
      { id: "k_hi", title: "hi", notes: "", tag_ids: ["t_hi"], created_at: "1970-01-01T00:00:00Z", start_date: ISO },
      { id: "k_lo", title: "lo", notes: "", tag_ids: ["t_lo"], created_at: "1970-01-01T00:00:00Z", start_date: ISO },
    ],
    template_tasks: [
      { id: "tmpl_mid", title: "recur-mid", notes: "", tag_ids: ["t_mid"], created_at: "",
        recurrence: { kind: "daily" }, recurrence_tag_id: "t_mid" },
    ],
  });
}

describe("mergeRows interleaves ghosts with tasks (promotion keeps order)", () => {
  const label = (r: { kind: "task"; task: Task } | { kind: "ghost"; ghost: unknown }) =>
    r.kind === "ghost" ? "MID" : r.task.id;

  it("priority mode: a ghost sorts by its tag weight, between higher and lower tasks", () => {
    const ix = buildIndexes(recurMergeDoc("priority"));
    const ghosts = ix.ghostsForDate(ISO);
    expect(ghosts.map(g => g.title)).toEqual(["recur-mid"]);
    const rows = ix.mergeRows(ix.today(ISO), ghosts);
    expect(rows.map(label)).toEqual(["k_hi", "MID", "k_lo"]);
  });

  it("the ghost occupies the exact slot its promoted task would (no reorder on promote)", () => {
    const ghosted = buildIndexes(recurMergeDoc("priority"));
    const ghostOrder = ghosted.mergeRows(ghosted.today(ISO), ghosted.ghostsForDate(ISO)).map(label);
    // Promote = a real task started ISO with the mid tag, appended to the doc.
    const promoted = buildIndexes(doc({
      settings: { theme: "auto", sort_order: "priority" },
      tags: WEIGHTED_TAGS,
      tasks: [
        { id: "k_hi", title: "hi", notes: "", tag_ids: ["t_hi"], created_at: "1970-01-01T00:00:00Z", start_date: ISO },
        { id: "k_lo", title: "lo", notes: "", tag_ids: ["t_lo"], created_at: "1970-01-01T00:00:00Z", start_date: ISO },
        { id: "k_mid", title: "recur-mid", notes: "", tag_ids: ["t_mid"], created_at: "1970-01-01T00:00:00Z", start_date: ISO },
      ],
    }));
    const taskOrder = promoted.today(ISO).map(t => (t.id === "k_mid" ? "MID" : t.id));
    expect(ghostOrder).toEqual(taskOrder);
  });

  it("weight merge (Upcoming): interleaves by weight regardless of the global sort order", () => {
    const ix = buildIndexes(recurMergeDoc("date"));
    const rows = ix.mergeRowsByWeight(ix.today(ISO), ix.ghostsForDate(ISO));
    expect(rows.map(label)).toEqual(["k_hi", "MID", "k_lo"]);
  });
});
