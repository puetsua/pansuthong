import { describe, it, expect, vi } from "vitest";
import { TAG_PALETTE, pickPaletteColor, resolveTagIds } from "./quickAdd";
import { Tag } from "../lib/tauri";

const mkTag = (id: string, name: string): Tag => ({ id, name, color: "#000000", priority: 0 });

describe("pickPaletteColor", () => {
  it("is deterministic for the same seed", () => {
    expect(pickPaletteColor("work")).toBe(pickPaletteColor("work"));
  });
  it("returns a color from the palette", () => {
    expect(TAG_PALETTE).toContain(pickPaletteColor("anything"));
  });
});

describe("resolveTagIds", () => {
  it("reuses an existing tag case-insensitively and does not create it", async () => {
    const byName = new Map<string, Tag>([["work", mkTag("t_work", "work")]]);
    const addTag = vi.fn();
    const ids = await resolveTagIds(["Work"], byName, addTag);
    expect(ids).toEqual(["t_work"]);
    expect(addTag).not.toHaveBeenCalled();
  });

  it("creates an unknown tag in the typed case, with a case-stable palette color", async () => {
    const byName = new Map<string, Tag>();
    const addTag = vi.fn(async (name: string, _color: string) => mkTag("t_new", name));
    const ids = await resolveTagIds(["Errand"], byName, addTag);
    expect(ids).toEqual(["t_new"]);
    // Name keeps its case; the color is seeded from the lowercased name so
    // "Errand" and "errand" would resolve to the same palette color.
    expect(addTag).toHaveBeenCalledWith("Errand", pickPaletteColor("errand"));
  });

  it("preserves order across mixed existing/new tags", async () => {
    const byName = new Map<string, Tag>([["work", mkTag("t_work", "work")]]);
    const addTag = vi.fn(async (name: string) => mkTag("t_" + name, name));
    const ids = await resolveTagIds(["work", "home"], byName, addTag);
    expect(ids).toEqual(["t_work", "t_home"]);
  });
});
