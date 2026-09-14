import { describe, it, expect } from "vitest";
import {
  buildComposerTagOptions,
  formatComposerTagToken,
  getActiveTagFragment,
  replaceComposerTagToken,
  tokenEndAt,
} from "./composerTagSuggest";
import type { Tag } from "../lib/tauri";

const tags: Tag[] = [
  { id: "t_work", name: "work", color: "#06b6d4", priority: 5 },
  { id: "t_home", name: "home", color: "#ef4444", priority: 1 },
  { id: "t_weekend", name: "weekend chores", color: "#888", priority: 0 },
];

describe("getActiveTagFragment", () => {
  it("detects unquoted fragment at caret", () => {
    const input = "Buy milk #wo";
    const caret = input.length;
    expect(getActiveTagFragment(input, caret)).toEqual({
      start: 9,
      tokenEnd: 12,
      rawFragment: "wo",
    });
  });

  it("returns null when caret is outside a tag token", () => {
    expect(getActiveTagFragment("Buy milk", 3)).toBeNull();
    expect(getActiveTagFragment("Buy milk #work ", 15)).toBeNull();
  });

  it("detects bare # with empty fragment", () => {
    const input = "Task #";
    expect(getActiveTagFragment(input, input.length)).toEqual({
      start: 5,
      tokenEnd: 6,
      rawFragment: "",
    });
  });

  it("detects in-progress quoted tag", () => {
    const input = 'Plan #"weekend ch';
    const caret = input.length;
    expect(getActiveTagFragment(input, caret)).toEqual({
      start: 5,
      tokenEnd: input.length,
      rawFragment: "weekend ch",
    });
  });

  it("returns null for completed quoted tag", () => {
    const input = 'Plan #"weekend chores" due fri';
    const hashIdx = input.indexOf("#");
    const endQuote = input.indexOf('"', hashIdx + 2) + 1;
    expect(getActiveTagFragment(input, endQuote)).toBeNull();
  });
});

describe("tokenEndAt", () => {
  it("stops at whitespace for simple tags", () => {
    expect(tokenEndAt("a #wo b", 2)).toBe(5);
  });

  it("includes closing quote for quoted tags", () => {
    const s = 'x #"a b" y';
    const start = s.indexOf("#");
    expect(tokenEndAt(s, start)).toBe(start + 6);
  });
});

describe("formatComposerTagToken", () => {
  it("uses bare hash for single-word names", () => {
    expect(formatComposerTagToken("work")).toBe("#work");
  });

  it("quotes names with spaces", () => {
    expect(formatComposerTagToken("weekend chores")).toBe('#"weekend chores"');
  });
});

describe("buildComposerTagOptions", () => {
  it("puts create first when fragment is non-empty and novel", () => {
    const opts = buildComposerTagOptions(tags, "wo");
    expect(opts[0]).toEqual({ kind: "create", name: "wo" });
    expect(opts.some(o => o.kind === "existing" && o.tag.name === "work")).toBe(true);
  });

  it("omits create for bare #", () => {
    const opts = buildComposerTagOptions(tags, "");
    expect(opts.every(o => o.kind === "existing")).toBe(true);
    expect(opts.length).toBe(3);
  });

  it("omits create when name matches an existing tag", () => {
    const opts = buildComposerTagOptions(tags, "work");
    expect(opts.some(o => o.kind === "create")).toBe(false);
    expect(opts[0]).toEqual({ kind: "existing", tag: tags[0] });
  });
});

describe("replaceComposerTagToken", () => {
  it("replaces partial token with full tag name", () => {
    const input = "Review #wo due fri";
    const fragment = getActiveTagFragment(input, 9)!;
    const { value, caret } = replaceComposerTagToken(input, fragment, "work");
    expect(value).toBe("Review #work due fri");
    expect(caret).toBe(12);
  });

  it("quotes spaced tag names", () => {
    const input = "Plan #we";
    const fragment = getActiveTagFragment(input, input.length)!;
    const { value } = replaceComposerTagToken(input, fragment, "weekend chores");
    expect(value).toBe('Plan #"weekend chores"');
  });
});
