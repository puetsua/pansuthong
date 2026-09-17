import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/** Desktop portaled overlays must leave the custom titlebar draggable (#232). */
describe("desktop overlay CSS", () => {
  const css = readFileSync(resolve(__dirname, "global.css"), "utf-8");

  it("defines a shared titlebar height token for desktop shell", () => {
    expect(css).toMatch(/:root\[data-shell="desktop"\]\s*\{[^}]*--desktop-titlebar-height:\s*32px/);
    expect(css).toMatch(/\.desktop-titlebar\s*\{[^}]*flex:\s*0\s+0\s+var\(--desktop-titlebar-height\)/);
  });

  it("insets full-viewport overlay layers below the titlebar on desktop", () => {
    const overlayRule =
      /:root\[data-shell="desktop"\][^{]+\{[^}]*top:\s*var\(--desktop-titlebar-height\)/;
    expect(css).toMatch(overlayRule);
    for (const cls of [
      ".modal-backdrop",
      ".te-confirm",
      ".te-lightbox",
      ".ctx-menu-backdrop",
      ".sidebar-ctx-backdrop",
    ]) {
      expect(css).toContain(cls);
    }
  });
});
