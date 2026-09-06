import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/** Locks calendar month/week equal-column layout and title truncation (issue #211). */
describe("calendar grid CSS", () => {
  const css = readFileSync(resolve(__dirname, "global.css"), "utf-8");

  const equalSevenCol = /\.calendar-weekdays,\s*\.calendar-month-week,\s*\.calendar-week-grid,\s*\.calendar-day-strip\s*\{[^}]*display:\s*flex/;

  const equalChild = /\.calendar-weekday,\s*\.calendar-month-cell,\s*\.calendar-week-col,\s*\.calendar-day-strip-btn\s*\{[^}]*flex:\s*1 1 0[^}]*width:\s*0[^}]*min-width:\s*0/;

  it("uses flex equal-width columns for all 7-day rows (WebKitGTK)", () => {
    expect(css).toMatch(equalSevenCol);
    expect(css).toMatch(equalChild);
    expect(css).not.toMatch(/\.calendar-month-week\s*\{[^}]*grid-template-columns:\s*repeat\(7/);
    expect(css).not.toMatch(/\.calendar-week-grid\s*\{[^}]*grid-template-columns:\s*repeat\(7/);
    expect(css).not.toMatch(/\.calendar-day-strip\s*\{[^}]*grid-template-columns:\s*repeat\(7/);
  });

  it("allows month cells to shrink and clip overflow", () => {
    expect(css).toMatch(/\.calendar-month-cell\s*\{[^}]*overflow:\s*hidden/);
  });

  it("allows week columns and rows to shrink below content min-size", () => {
    expect(css).toMatch(/\.calendar-week-col\s*\{[^}]*overflow:\s*hidden/);
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
