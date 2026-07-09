import { describe, it, expect } from "vitest";
import { taskMatchesQuery } from "./taskSearch";

const task = (over: { title?: string; notes?: string; tag_ids?: string[] } = {}) => ({
  title: over.title ?? "Buy milk",
  notes: over.notes ?? "",
  tag_ids: over.tag_ids ?? [],
});

const tags = (...entries: [string, string][]) =>
  new Map(entries.map(([id, name]) => [id, { name }]));

describe("taskMatchesQuery", () => {
  it("matches a case-insensitive substring of the title", () => {
    expect(taskMatchesQuery(task({ title: "Buy Milk" }), "milk")).toBe(true);
    expect(taskMatchesQuery(task({ title: "Buy Milk" }), "BUY")).toBe(true);
  });

  it("matches a case-insensitive substring of the notes", () => {
    expect(taskMatchesQuery(task({ title: "Read", notes: "about MILK production" }), "milk")).toBe(true);
  });

  it("matches a case-insensitive substring of a tag name", () => {
    const byId = tags(["t_work", "Work"], ["t_home", "Home"]);
    expect(taskMatchesQuery(task({ title: "Call", tag_ids: ["t_work"] }), "wor", byId)).toBe(true);
    expect(taskMatchesQuery(task({ title: "Call", tag_ids: ["t_home"] }), "WORK", byId)).toBe(false);
  });

  it("ignores unknown tag ids when matching tags", () => {
    const byId = tags(["t_work", "Work"]);
    expect(taskMatchesQuery(task({ title: "Call", tag_ids: ["missing"] }), "work", byId)).toBe(false);
  });

  it("returns false for an empty or whitespace-only query", () => {
    expect(taskMatchesQuery(task(), "")).toBe(false);
    expect(taskMatchesQuery(task(), "   ")).toBe(false);
  });

  it("returns false when title, notes, and tags do not contain the query", () => {
    const byId = tags(["t_home", "Home"]);
    expect(taskMatchesQuery(
      task({ title: "Call dentist", notes: "Tuesday", tag_ids: ["t_home"] }),
      "milk",
      byId,
    )).toBe(false);
  });
});
