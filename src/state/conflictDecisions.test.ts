import { describe, expect, it } from "vitest";
import { Task, TaskDiff } from "../lib/tauri";
import { bulkAction, nextConflictPath } from "./conflictDecisions";

const t = (id: string): Task => ({
  id, title: id, notes: "", tag_ids: [], created_at: "1970-01-01T00:00:00Z",
});

const differs:    TaskDiff = { kind: "differs",     id: "a", mine: t("a"), theirs: t("a") };
const onlyMine:   TaskDiff = { kind: "only_mine",   id: "b", mine: t("b") };
const onlyTheirs: TaskDiff = { kind: "only_theirs", id: "c", theirs: t("c") };

describe("bulkAction (#31)", () => {
  it('"use all mine" keeps mine on differs/only-mine and drops only-theirs', () => {
    expect(bulkAction(differs, "mine")).toBe("keep_mine");
    expect(bulkAction(onlyMine, "mine")).toBe("keep_mine");
    // a theirs-only row does not offer keep_mine — the valid "use mine" intent is to drop it
    expect(bulkAction(onlyTheirs, "mine")).toBe("drop");
  });

  it('"use all theirs" keeps theirs on differs/only-theirs and drops only-mine', () => {
    expect(bulkAction(differs, "theirs")).toBe("keep_theirs");
    expect(bulkAction(onlyTheirs, "theirs")).toBe("keep_theirs");
    // a mine-only row does not offer keep_theirs — the valid "use theirs" intent is to drop it
    expect(bulkAction(onlyMine, "theirs")).toBe("drop");
  });

  it("only ever returns an action the row actually offers", () => {
    const offered: Record<TaskDiff["kind"], Decision_action[]> = {
      differs:     ["keep_mine", "keep_theirs", "keep_both"],
      only_mine:   ["keep_mine", "drop"],
      only_theirs: ["keep_theirs", "drop"],
    };
    for (const d of [differs, onlyMine, onlyTheirs]) {
      for (const intent of ["mine", "theirs"] as const) {
        expect(offered[d.kind]).toContain(bulkAction(d, intent));
      }
    }
  });
});

type Decision_action = "keep_mine" | "keep_theirs" | "keep_both" | "drop";

describe("nextConflictPath (#37)", () => {
  it("returns the first remaining conflict that is not the current one", () => {
    expect(nextConflictPath(["/x/b.json", "/x/c.json"], "/x/a.json")).toBe("/x/b.json");
  });

  it("skips the current path if it is still listed", () => {
    expect(nextConflictPath(["/x/a.json", "/x/b.json"], "/x/a.json")).toBe("/x/b.json");
  });

  it("returns null when nothing else remains", () => {
    expect(nextConflictPath([], "/x/a.json")).toBeNull();
    expect(nextConflictPath(["/x/a.json"], "/x/a.json")).toBeNull();
  });
});
