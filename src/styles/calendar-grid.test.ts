import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/** Locks calendar month/week equal-column layout and title truncation (issue #211). */
describe("calendar grid CSS", () => {
  const css = readFileSync(resolve(__dirname, "global.css"), "utf-8");

  const equalMonthStrip = /\.calendar-weekdays,\s*\.calendar-month-week,\s*\.calendar-day-strip\s*\{[^}]*display:\s*flex/;

  const equalMonthChild = /\.calendar-weekday,\s*\.calendar-month-cell,\s*\.calendar-day-strip-btn\s*\{[^}]*flex:\s*1 1 0[^}]*width:\s*0[^}]*min-width:\s*0/;

  const equalWeekChild = /\.calendar-week-head-cell,\s*\.calendar-week-body-cell\s*\{[^}]*flex:\s*1 1 0[^}]*width:\s*0[^}]*min-width:\s*0/;

  it("uses flex equal-width columns for month and day-strip rows (WebKitGTK)", () => {
    expect(css).toMatch(equalMonthStrip);
    expect(css).toMatch(equalMonthChild);
    expect(css).not.toMatch(/\.calendar-month-week\s*\{[^}]*grid-template-columns:\s*repeat\(7/);
    expect(css).not.toMatch(/\.calendar-day-strip\s*\{[^}]*grid-template-columns:\s*repeat\(7/);
  });

  it("uses split week head/body strips with flex equal columns", () => {
    expect(css).toMatch(/\.calendar-week-grid\s*\{[^}]*flex-direction:\s*column/);
    expect(css).toMatch(/\.calendar-week-head-strip,\s*\.calendar-week-body-strip\s*\{[^}]*display:\s*flex/);
    expect(css).toMatch(equalWeekChild);
    expect(css).toMatch(/\.calendar-week-head-strip\s*\{[^}]*align-items:\s*stretch/);
    expect(css).toMatch(/\.calendar-week-body-strip\s*\{[^}]*align-items:\s*stretch/);
    expect(css).not.toMatch(/\.calendar-week-grid\s*\{[^}]*grid-template-columns/);
  });

  it("locks equal week header cell height (today badge only, no weekday suffix)", () => {
    expect(css).toMatch(/\.calendar-week-head-cell\s*\{[^}]*height:\s*4\.875rem/);
    expect(css).toMatch(/\.calendar-week-col-head\s*\{[^}]*grid-template-rows:\s*1\.1em 1\.75rem 1\.1em/);
    expect(css).toMatch(/\.calendar-week-col-weekday\s*\{[^}]*height:\s*1\.1em/);
    expect(css).toMatch(/\.calendar-week-col-count\s*\{[^}]*height:\s*1\.1em/);
  });

  it("allows month cells to shrink and clip overflow", () => {
    expect(css).toMatch(/\.calendar-month-cell\s*\{[^}]*overflow:\s*hidden/);
  });

  it("puts identical body padding on week body cells, not inner body", () => {
    expect(css).toMatch(/\.calendar-week-body-cell\s*\{[^}]*padding:\s*var\(--space-1\)/);
    expect(css).toMatch(/\.calendar-week-col-body\s*\{[^}]*padding:\s*0/);
    expect(css).toMatch(/\.calendar-week-col-body\s*\{[^}]*margin:\s*0/);
    expect(css).toMatch(/\.calendar-week-row\s*\{[^}]*margin:\s*0/);
    expect(css).toMatch(/\.calendar-week-col-head\s*\{[^}]*margin:\s*0/);
  });

  it("clips titles inside non-flex clip grid (WebKitGTK button workaround)", () => {
    expect(css).toMatch(/\.calendar-month-line\s*\{[^}]*display:\s*block/);
    expect(css).toMatch(/\.calendar-month-line\s*\{[^}]*overflow:\s*hidden/);
    expect(css).toMatch(
      /\.calendar-line-clip\s*\{[^}]*grid-template-columns:\s*auto minmax\(0,\s*1fr\)/,
    );
    expect(css).toMatch(/\.calendar-line-title,\s*\.calendar-week-row-title\s*\{[^}]*text-overflow:\s*ellipsis/);
    expect(css).toMatch(/\.calendar-week-row\s*\{[^}]*display:\s*block/);
    expect(css).toMatch(/\.calendar-week-col-weekday\s*\{[^}]*white-space:\s*nowrap/);
    expect(css).toMatch(/\.calendar-week-col-day\s*\{[^}]*height:\s*1\.75rem/);
  });
});
