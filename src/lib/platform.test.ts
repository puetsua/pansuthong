import { describe, it, expect } from "vitest";
import { modKeyLabel } from "./platform";

describe("modKeyLabel", () => {
  it("uses ⌘ on macOS", () => {
    expect(modKeyLabel(true)).toBe("⌘");
  });

  it("uses Ctrl on Windows and Linux", () => {
    expect(modKeyLabel(false)).toBe("Ctrl");
  });
});
