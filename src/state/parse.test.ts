import { describe, expect, it } from "vitest";
import { parseComposer } from "./parse";

const TODAY = "2026-05-28"; // Thursday

describe("parseComposer", () => {
  it("plain title passes through", () => {
    const p = parseComposer("Buy milk", TODAY);
    expect(p.title).toBe("Buy milk");
    expect(p.tag_names).toEqual([]);
    expect(p.due_date).toBeUndefined();
    expect(p.priority).toBeUndefined();
  });

  it("hash tag extracts", () => {
    const p = parseComposer("Reply to Anna #work", TODAY);
    expect(p.title).toBe("Reply to Anna");
    expect(p.tag_names).toEqual(["work"]);
  });

  it("priority bangs", () => {
    expect(parseComposer("! task", TODAY).priority).toBe("low");
    expect(parseComposer("!! task", TODAY).priority).toBe("med");
    expect(parseComposer("!!! task", TODAY).priority).toBe("high");
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

  it("sched alias", () => {
    expect(parseComposer("Task sched today", TODAY).scheduled_date).toBe(TODAY);
    expect(parseComposer("Task scheduled today", TODAY).scheduled_date).toBe(TODAY);
  });

  it("unrecognized due word stays in title", () => {
    expect(parseComposer("Task due whenever", TODAY).title).toBe("Task due whenever");
  });

  it("everything together", () => {
    const p = parseComposer("!! Review #work due fri", TODAY);
    expect(p.title).toBe("Review");
    expect(p.tag_names).toEqual(["work"]);
    expect(p.priority).toBe("med");
    expect(p.due_date).toBe("2026-05-29");
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
});
