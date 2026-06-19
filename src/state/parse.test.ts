import { describe, expect, it } from "vitest";
import { parseComposer } from "./parse";

const TODAY = "2026-05-28"; // Thursday

describe("parseComposer", () => {
  it("plain title passes through", () => {
    const p = parseComposer("Buy milk", TODAY);
    expect(p.title).toBe("Buy milk");
    expect(p.tag_names).toEqual([]);
    expect(p.due_date).toBeUndefined();
  });

  it("hash tag extracts", () => {
    const p = parseComposer("Reply to Anna #work", TODAY);
    expect(p.title).toBe("Reply to Anna");
    expect(p.tag_names).toEqual(["work"]);
  });

  it("bangs are literal title text (priority shortcut removed)", () => {
    expect(parseComposer("! task", TODAY).title).toBe("! task");
    expect(parseComposer("!!task", TODAY).title).toBe("!!task");
    expect(parseComposer("!!! urgent thing", TODAY).title).toBe("!!! urgent thing");
  });

  it("due today", () => {
    expect(parseComposer("Call due today", TODAY).due_date).toBe(TODAY);
  });

  it("due tomorrow", () => {
    expect(parseComposer("Ship due tomorrow", TODAY).due_date).toBe("2026-05-29");
  });

  it("due fri = next Friday", () => {
    expect(parseComposer("Ship due fri", TODAY).due_date).toBe("2026-05-29");
  });

  it("due thu = next week's Thursday (not today)", () => {
    expect(parseComposer("Standup due thu", TODAY).due_date).toBe("2026-06-04");
  });

  it("due M/D uses current year", () => {
    expect(parseComposer("Bday due 6/10", TODAY).due_date).toBe("2026-06-10");
  });

  it("start keyword sets the start date; sched/scheduled stay as aliases", () => {
    expect(parseComposer("Task start today", TODAY).start_date).toBe(TODAY);
    expect(parseComposer("Task sched today", TODAY).start_date).toBe(TODAY);
    expect(parseComposer("Task scheduled today", TODAY).start_date).toBe(TODAY);
  });

  it("unrecognized due word stays in title", () => {
    expect(parseComposer("Task due whenever", TODAY).title).toBe("Task due whenever");
  });

  it("everything together", () => {
    const p = parseComposer("Review #work due fri", TODAY);
    expect(p.title).toBe("Review");
    expect(p.tag_names).toEqual(["work"]);
    expect(p.due_date).toBe("2026-05-29");
  });

  it("quoted tag captures spaces as one tag", () => {
    const p = parseComposer('test3 #"da fs"', TODAY);
    expect(p.title).toBe("test3");
    expect(p.tag_names).toEqual(["da fs"]);
  });

  it("quoted tag coexists with plain tags and dates", () => {
    const p = parseComposer('Plan #"big project" #work due fri', TODAY);
    expect(p.title).toBe("Plan");
    expect(p.tag_names).toEqual(["big project", "work"]);
    expect(p.due_date).toBe("2026-05-29");
  });

  it("unterminated quoted tag consumes to end of input", () => {
    const p = parseComposer('Buy milk #"weekend chores', TODAY);
    expect(p.title).toBe("Buy milk");
    expect(p.tag_names).toEqual(["weekend chores"]);
  });

  it("empty quoted tag is literal title text, not a tag", () => {
    const p = parseComposer('Title #"" done', TODAY);
    expect(p.tag_names).toEqual([]);
    expect(p.title).toBe('Title #"" done');
  });

  it("quoted tag trims surrounding whitespace", () => {
    expect(parseComposer('x #"  spaced  "', TODAY).tag_names).toEqual(["spaced"]);
  });

  it("rejects out-of-range MM/DD", () => {
    // 13 is not a valid month
    expect(parseComposer("Task due 13/5", TODAY).due_date).toBeUndefined();
    expect(parseComposer("Task due 13/5", TODAY).title).toBe("Task due 13/5");
  });

  it("rejects invalid day-of-month overflow", () => {
    // Feb 30 doesn't exist
    expect(parseComposer("Task due 2/30", TODAY).due_date).toBeUndefined();
    expect(parseComposer("Task due 2/30", TODAY).title).toBe("Task due 2/30");
  });

  it("accepts valid MM/DD edges", () => {
    expect(parseComposer("Task due 12/31", TODAY).due_date).toBe("2026-12-31");
    expect(parseComposer("Task due 1/1",   TODAY).due_date).toBe("2026-01-01");
  });

  it("accepts a valid YYYY-MM-DD literal", () => {
    expect(parseComposer("Task due 2026-02-28", TODAY).due_date).toBe("2026-02-28");
  });

  it("rejects an out-of-range YYYY-MM-DD literal", () => {
    // month 13 and Feb 30 are not real dates; the shape-only regex must not
    // accept them (the dayjs format arg is a no-op without customParseFormat)
    expect(parseComposer("Task due 2026-13-05", TODAY).due_date).toBeUndefined();
    expect(parseComposer("Task due 2026-13-05", TODAY).title).toBe("Task due 2026-13-05");
    expect(parseComposer("Task due 2026-02-30", TODAY).due_date).toBeUndefined();
  });

  it("~duration sets the estimate and is dropped from the title", () => {
    const p = parseComposer("Write report ~1h30m", TODAY);
    expect(p.title).toBe("Write report");
    expect(p.estimated_seconds).toBe(5400);
  });

  it("~ accepts single-unit durations", () => {
    expect(parseComposer("Call ~45m", TODAY).estimated_seconds).toBe(2700);
    expect(parseComposer("Nap ~2h", TODAY).estimated_seconds).toBe(7200);
  });

  it("~ bare number means minutes (matches the editor's estimate field)", () => {
    expect(parseComposer("Task ~30", TODAY).estimated_seconds).toBe(1800);
  });

  it("~estimate coexists with tags and dates", () => {
    const p = parseComposer("Write report ~1h30m #work due fri", TODAY);
    expect(p.title).toBe("Write report");
    expect(p.estimated_seconds).toBe(5400);
    expect(p.tag_names).toEqual(["work"]);
    expect(p.due_date).toBe("2026-05-29");
  });

  it("last ~estimate wins", () => {
    expect(parseComposer("Plan ~30m ~1h", TODAY).estimated_seconds).toBe(3600);
  });

  it("~ accepts ISO-8601 durations (same grammar as the editor field)", () => {
    expect(parseComposer("Sprint ~PT1H30M", TODAY).estimated_seconds).toBe(5400);
  });

  it("unparseable ~token stays in the title", () => {
    const p = parseComposer("Task ~abc", TODAY);
    expect(p.estimated_seconds).toBeUndefined();
    expect(p.title).toBe("Task ~abc");
  });

  it("zero / out-of-range ~estimate stays in the title", () => {
    const zero = parseComposer("Task ~0m", TODAY);
    expect(zero.estimated_seconds).toBeUndefined();
    expect(zero.title).toBe("Task ~0m");
    const huge = parseComposer("Task ~999999h", TODAY);
    expect(huge.estimated_seconds).toBeUndefined();
    expect(huge.title).toBe("Task ~999999h");
  });

  it("a bare ~ is literal title text", () => {
    expect(parseComposer("Buy ~ milk", TODAY).title).toBe("Buy ~ milk");
  });
});
