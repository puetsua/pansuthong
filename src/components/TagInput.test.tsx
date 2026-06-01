import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Tag } from "../lib/tauri";
import { TagInput } from "./TagInput";

const tags = new Map<string, Tag>([
  ["t_a", { id: "t_a", name: "work", color: "#06b6d4", priority: 5 }],
  ["t_b", { id: "t_b", name: "home", color: "#ef4444", priority: 1 }],
]);

const handlers = () => ({
  onAddExisting: vi.fn(),
  onAddNew: vi.fn(),
  onRemoveExisting: vi.fn(),
  onRemoveNew: vi.fn(),
});

const button = (name: RegExp | string) => screen.getByRole("button", { name });

beforeEach(() => vi.clearAllMocks());

describe("TagInput", () => {
  it("renders assigned tags and pending new tags as removable chips", () => {
    const h = handlers();
    render(<TagInput allTags={tags} tagIds={["t_a"]} newNames={["urgent"]} {...h} />);

    fireEvent.click(button("Remove work"));
    expect(h.onRemoveExisting).toHaveBeenCalledWith("t_a");

    fireEvent.click(button(/Remove urgent/));
    expect(h.onRemoveNew).toHaveBeenCalledWith("urgent");
  });

  it("filters candidates to a case-insensitive substring of the query", () => {
    const h = handlers();
    render(<TagInput allTags={tags} tagIds={[]} newNames={[]} {...h} />);

    const input = screen.getByLabelText("Add tag");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "HO" } });

    expect(screen.getByRole("button", { name: "home" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "work" })).toBeNull();
  });

  it("Enter adds the highlighted existing candidate", () => {
    const h = handlers();
    render(<TagInput allTags={tags} tagIds={[]} newNames={[]} {...h} />);

    const input = screen.getByLabelText("Add tag");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "home" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(h.onAddExisting).toHaveBeenCalledWith("t_b");
    expect(h.onAddNew).not.toHaveBeenCalled();
  });

  it("offers a Create row for an unknown name and adds it in the typed case", () => {
    const h = handlers();
    render(<TagInput allTags={tags} tagIds={[]} newNames={[]} {...h} />);

    const input = screen.getByLabelText("Add tag");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "Errand" } });
    fireEvent.click(button(/create/i));

    expect(h.onAddNew).toHaveBeenCalledWith("Errand");
  });

  it("does not offer Create when the name matches an existing tag in a different case", () => {
    const h = handlers();
    render(<TagInput allTags={tags} tagIds={[]} newNames={[]} {...h} />);

    const input = screen.getByLabelText("Add tag");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "WORK" } });

    expect(screen.queryByRole("button", { name: /create/i })).toBeNull();
  });

  it("does not offer Create when the name matches an existing tag", () => {
    const h = handlers();
    render(<TagInput allTags={tags} tagIds={[]} newNames={[]} {...h} />);

    const input = screen.getByLabelText("Add tag");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "work" } });

    expect(screen.queryByRole("button", { name: /create/i })).toBeNull();
    expect(screen.getByRole("button", { name: "work" })).toBeTruthy();
  });

  it("Escape clears the query instead of closing", () => {
    const h = handlers();
    render(<TagInput allTags={tags} tagIds={[]} newNames={[]} {...h} />);

    const input = screen.getByLabelText("Add tag") as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "wo" } });
    // "wo" filters out "home", leaving only "work".
    expect(screen.queryByRole("button", { name: "home" })).toBeNull();

    fireEvent.keyDown(input, { key: "Escape" });
    // The query is cleared (so the full candidate list returns) rather than the
    // modal closing — "home" reappears.
    expect(input.value).toBe("");
    expect(screen.getByRole("button", { name: "home" })).toBeTruthy();
  });
});
