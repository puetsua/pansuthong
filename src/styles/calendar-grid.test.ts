import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/** Locks calendar month/week equal-column layout and title truncation (issue #211). */
describe("calendar grid CSS", () => {
  const css = readFileSync(resolve(__dirname, "global.css"), "utf-8");

  it("month grid uses minmax(0, 1fr) so content cannot expand day columns", () => {
    expect(css).toMatch(
      /\.calendar-weekdays,\s*\.calendar-month-week\s*\{[^}]*grid-template-columns:\s*repeat\(7,\s*minmax\(0,\s*1fr\)\)/,
    );
  });

  it("allows month cells to shrink and clip overflow", () => {
    expect(css).toMatch(/\.calendar-month-cell\s*\{[^}]*min-width:\s*0/);
    expect(css).toMatch(/\.calendar-month-cell\s*\{[^}]*overflow:\s*hidden/);
  });

  it("week grid uses minmax(0, 1fr) for equal day columns", () => {
    expect(css).toMatch(
      /\.calendar-week-grid\s*\{[^}]*grid-template-columns:\s*repeat\(7,\s*minmax\(0,\s*1fr\)\)/,
    );
  });

  it("allows week columns and rows to shrink below content min-size", () => {
    expect(css).toMatch(/\.calendar-week-col\s*\{[^}]*min-width:\s*0/);
    expect(css).toMatch(/\.calendar-week-col-body\s*\{[^}]*min-width:\s*0/);
    expect(css).toMatch(/\.calendar-week-row\s*\{[^}]*min-width:\s*0/);
  });

  it("clips titles inside non-flex clip grid (WebKitGTK button workaround)", () => {
    expect(css).toMatch(/\.calendar-month-line\s*\{[^}]*display:\s*block/);
    expect(css).toMatch(/\.calendar-month-line\s*\{[^}]*overflow:\s*hidden/);
    expect(css).toMatch(
      /\.calendar-line-clip\s*\{[^}]*grid-template-columns:\s*auto minmax\(0,\s*1fr\)/,
    );
    expect(css).toMatch(/\.calendar-line-title,\s*\.calendar-week-row-title\s*\{[^}]*text-overflow:\s*ellipsis/);
    expect(css).toMatch(/\.calendar-week-row\s*\{[^}]*display:\s*block/);
  });
});
