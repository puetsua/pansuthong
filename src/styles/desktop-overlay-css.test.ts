import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/** Desktop portaled overlays must leave the custom titlebar draggable (#232/#233). */
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

  it("stacks the titlebar above portaled overlays for drag hit-testing", () => {
    // Must clear theme-confirm (1000), AFK (110), and modal-backdrop (100).
    expect(css).toMatch(/\.desktop-titlebar\s*\{[^}]*position:\s*relative/);
    expect(css).toMatch(/\.desktop-titlebar\s*\{[^}]*z-index:\s*1100/);
    expect(css).toMatch(/\.modal-backdrop\s*\{[^}]*z-index:\s*100/);
    expect(css).toMatch(/\.theme-confirm-backdrop\s*\{[^}]*z-index:\s*1000/);
    // Modals keep capturing outside the dialog (no pointer-events:none backdrop pattern).
    const backdropBlock = css.match(/\.modal-backdrop\s*\{[^}]*\}/)?.[0] ?? "";
    expect(backdropBlock).not.toMatch(/pointer-events:\s*none/);
  });
});
