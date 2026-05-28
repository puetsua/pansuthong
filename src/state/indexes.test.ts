import { describe, expect, it } from "vitest";
import sample from "../tests/fixtures/sample.json";
import { Document } from "../lib/tauri";
import { buildIndexes } from "./indexes";

const TODAY = "2026-05-28";

describe("buildIndexes", () => {
  const ix = buildIndexes(sample as unknown as Document);

  it("today contains overdue + scheduled today + due today", () => {
    const ids = ix.today(TODAY).map(t => t.id);
    expect(ids).toEqual(["k_overdue1", "k_today1", "k_today2", "k_reno1"]);
  });

  it("inbox contains only tasks with no project-linked tags", () => {
    expect(ix.inbox.map(t => t.id)).toEqual(["k_today1", "k_future1"]);
  });

  it("byProject for p_work returns the two work tasks", () => {
    expect(ix.byProject.get("p_work")?.map(t => t.id)).toEqual(["k_overdue1", "k_today2"]);
  });

  it("byTag for t_urgent returns one task", () => {
    expect(ix.byTag.get("t_urgent")?.map(t => t.id)).toEqual(["k_overdue1"]);
  });
});
