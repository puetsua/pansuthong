import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { TagEditor } from "./TagEditor";

vi.mock("../lib/tauri", () => ({
  api: {
    addTag: vi.fn().mockResolvedValue({}),
    updateTag: vi.fn().mockResolvedValue({}),
    deleteTag: vi.fn().mockResolvedValue(undefined),
  },
}));

import { api } from "../lib/tauri";

const tag = { id: "tag_1", name: "work", color: "#06b6d4", priority: 5 };

const nameInput = () => screen.getByLabelText("Name") as HTMLInputElement;
const weightInput = () => screen.getByLabelText("Weight") as HTMLInputElement;
const button = (name: string) => screen.getByRole("button", { name }) as HTMLButtonElement;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("TagEditor — create mode", () => {
  it("adds a tag with a trimmed, lowercased name and clamped weight, then closes", async () => {
    const onClose = vi.fn();
    render(<TagEditor onClose={onClose} />);

    fireEvent.change(nameInput(), { target: { value: "  Errands  " } });
    fireEvent.change(weightInput(), { target: { value: "10000" } });
    fireEvent.click(button("Save"));

    await waitFor(() =>
      expect(api.addTag).toHaveBeenCalledWith("errands", expect.any(String), 9999),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("disables Save until a name is entered", () => {
    render(<TagEditor onClose={vi.fn()} />);
    expect(button("Save").disabled).toBe(true);
    fireEvent.change(nameInput(), { target: { value: "shopping" } });
    expect(button("Save").disabled).toBe(false);
  });

  it("has no Delete button", () => {
    render(<TagEditor onClose={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
  });
});

describe("TagEditor — edit mode", () => {
  it("prefills the tag's fields", () => {
    render(<TagEditor tag={tag} onClose={vi.fn()} />);
    expect(nameInput().value).toBe("work");
    expect(weightInput().value).toBe("5");
  });

  it("updates the tag on Save, then closes", async () => {
    const onClose = vi.fn();
    render(<TagEditor tag={tag} onClose={onClose} />);

    fireEvent.change(nameInput(), { target: { value: "Office" } });
    fireEvent.click(button("Save"));

    await waitFor(() =>
      expect(api.updateTag).toHaveBeenCalledWith({
        id: "tag_1",
        name: "office",
        color: "#06b6d4",
        priority: 5,
      }),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("deletes the tag when confirmed and calls onDeleted", async () => {
    const onClose = vi.fn();
    const onDeleted = vi.fn();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<TagEditor tag={tag} onClose={onClose} onDeleted={onDeleted} />);

    fireEvent.click(button("Delete"));

    await waitFor(() => expect(api.deleteTag).toHaveBeenCalledWith("tag_1"));
    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
  });

  it("does not delete when the confirm is dismissed", () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<TagEditor tag={tag} onClose={vi.fn()} />);

    fireEvent.click(button("Delete"));

    expect(api.deleteTag).not.toHaveBeenCalled();
  });
});
