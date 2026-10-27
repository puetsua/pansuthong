import { describe, it, expect } from "vitest";
import { toggleTaskListMarker } from "./markdownTaskList";
import type { Position } from "unist";

const pos = (start: number, end: number): Position => ({
  start: { line: 1, column: 1, offset: start },
  end: { line: 1, column: 1, offset: end },
});

describe("toggleTaskListMarker", () => {
  it("checks an unchecked marker", () => {
    const notes = "- [ ] todo";
    expect(toggleTaskListMarker(notes, pos(0, notes.length))).toBe("- [x] todo");
  });

  it("unchecks lowercase x and uppercase X", () => {
    expect(toggleTaskListMarker("- [x] done", pos(0, 10))).toBe("- [ ] done");
    expect(toggleTaskListMarker("- [X] done", pos(0, 10))).toBe("- [ ] done");
  });

  it("toggles only within the given list item span", () => {
    const notes = "- [ ] buy milk\n- [ ] buy milk";
    const secondLineStart = notes.indexOf("- [ ] buy milk", 1);
    const secondLineEnd = notes.length;
    expect(toggleTaskListMarker(notes, pos(secondLineStart, secondLineEnd))).toBe(
      "- [ ] buy milk\n- [x] buy milk",
    );
  });
});
