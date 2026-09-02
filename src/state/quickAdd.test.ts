import { describe, it, expect, vi } from "vitest";
import { resolveTagIds } from "./quickAdd";
import { Tag } from "../lib/tauri";
import { DEFAULT_TAG_COLOR } from "../lib/settings";

const mkTag = (id: string, name: string): Tag => ({ id, name, color: "#000000", priority: 0 });

describe("resolveTagIds", () => {
  it("reuses an existing tag case-insensitively and does not create it", async () => {
    const byName = new Map<string, Tag>([["work", mkTag("t_work", "work")]]);
    const addTag = vi.fn();
    const ids = await resolveTagIds(["Work"], byName, addTag, "#4338ca");
    expect(ids).toEqual(["t_work"]);
    expect(addTag).not.toHaveBeenCalled();
  });

  it("creates an unknown tag in the typed case with the given theme background", async () => {
    const byName = new Map<string, Tag>();
    const addTag = vi.fn(async (name: string, _color: string) => mkTag("t_new", name));
    const ids = await resolveTagIds(["Errand"], byName, addTag, "#818cf8");
    expect(ids).toEqual(["t_new"]);
    expect(addTag).toHaveBeenCalledWith("Errand", "#818cf8");
  });

  it("defaults to the built-in light background when no color is passed", async () => {
    const byName = new Map<string, Tag>();
    const addTag = vi.fn(async (name: string, _color: string) => mkTag("t_new", name));
    await resolveTagIds(["Errand"], byName, addTag);
    expect(addTag).toHaveBeenCalledWith("Errand", DEFAULT_TAG_COLOR);
  });

  it("preserves order across mixed existing/new tags", async () => {
    const byName = new Map<string, Tag>([["work", mkTag("t_work", "work")]]);
    const addTag = vi.fn(async (name: string) => mkTag("t_" + name, name));
    const ids = await resolveTagIds(["work", "home"], byName, addTag, "#4338ca");
    expect(ids).toEqual(["t_work", "t_home"]);
  });
});
