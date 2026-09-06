import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/** Locks month grid equal-column layout (issue #211); week view already uses this pattern. */
describe("calendar month grid CSS", () => {
  const css = readFileSync(resolve(__dirname, "global.css"), "utf-8");

  it("uses minmax(0, 1fr) so content cannot expand day columns", () => {
    expect(css).toMatch(
      /\.calendar-weekdays,\s*\.calendar-month-week\s*\{[^}]*grid-template-columns:\s*repeat\(7,\s*minmax\(0,\s*1fr\)\)/,
    );
  });

  it("allows month cells to shrink below content min-size", () => {
    expect(css).toMatch(/\.calendar-month-cell\s*\{[^}]*min-width:\s*0/);
  });
});
