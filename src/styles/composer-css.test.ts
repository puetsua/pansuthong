import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/** Composer quick-add: accent styling must not hit tag typeahead `.te-opt` buttons (#222). */
describe("composer CSS", () => {
  const css = readFileSync(resolve(__dirname, "global.css"), "utf-8");

  it("scopes accent button styling to the submit control, not all buttons", () => {
    expect(css).toMatch(/\.composer > button\[type="submit"\]\s*\{[^}]*background:\s*var\(--c-accent\)/);
    expect(css).not.toMatch(/\.composer button\s*\{[^}]*background:\s*var\(--c-accent\)/);
  });
});
