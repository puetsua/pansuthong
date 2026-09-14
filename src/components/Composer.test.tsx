import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Tag } from "../lib/tauri";
import { Composer } from "./Composer";

vi.mock("../lib/tauri", () => ({
  api: {
    addTask: vi.fn().mockResolvedValue({}),
    addTag: vi.fn(),
  },
}));

import { api } from "../lib/tauri";

const tags = new Map<string, Tag>([
  ["work", { id: "t_work", name: "work", color: "#06b6d4", priority: 5 }],
  ["home", { id: "t_home", name: "home", color: "#ef4444", priority: 1 }],
]);

const allTagsById = new Map<string, Tag>([
  ["t_work", tags.get("work")!],
  ["t_home", tags.get("home")!],
]);

const addTask = vi.mocked(api.addTask);

const add = (text: string) => {
  fireEvent.change(screen.getByLabelText("New task"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
};

beforeEach(() => vi.clearAllMocks());

describe("Composer", () => {
  it("auto-tags a task with the current tag view's tag (#106)", async () => {
    render(<Composer tagsByName={tags} contextTagId="t_work" />);

    add("buy milk");

    await waitFor(() => expect(addTask).toHaveBeenCalledTimes(1));
    expect(addTask.mock.calls[0][0]).toMatchObject({
      title: "buy milk",
      tag_ids: ["t_work"],
    });
  });

  it("does not duplicate the context tag when it is also typed", async () => {
    render(<Composer tagsByName={tags} contextTagId="t_work" />);

    add("buy milk #work");

    await waitFor(() => expect(addTask).toHaveBeenCalledTimes(1));
    expect(addTask.mock.calls[0][0].tag_ids).toEqual(["t_work"]);
  });

  it("keeps explicitly typed tags alongside the context tag", async () => {
    render(<Composer tagsByName={tags} contextTagId="t_work" />);

    add("buy milk #home");

    await waitFor(() => expect(addTask).toHaveBeenCalledTimes(1));
    expect(addTask.mock.calls[0][0].tag_ids).toEqual(["t_work", "t_home"]);
  });

  it("sends only typed tags when there is no context tag", async () => {
    render(<Composer tagsByName={tags} />);

    add("buy milk #home");

    await waitFor(() => expect(addTask).toHaveBeenCalledTimes(1));
    expect(addTask.mock.calls[0][0].tag_ids).toEqual(["t_home"]);
  });

  it("applies Today view startDate for plain quick-add", async () => {
    render(<Composer tagsByName={tags} startDate="2026-09-10" todayIso="2026-09-10" />);

    add("buy milk");

    await waitFor(() => expect(addTask).toHaveBeenCalledTimes(1));
    expect(addTask.mock.calls[0][0]).toMatchObject({
      title: "buy milk",
      start_date: "2026-09-10",
    });
  });

  it("does not apply Today startDate when only due is parsed (#215)", async () => {
    render(<Composer tagsByName={tags} startDate="2026-09-10" todayIso="2026-09-10" />);

    add("REPRO215 due-only due 2026-09-12");

    await waitFor(() => expect(addTask).toHaveBeenCalledTimes(1));
    expect(addTask.mock.calls[0][0]).toMatchObject({
      title: "REPRO215 due-only",
      due_date: "2026-09-12",
      start_date: undefined,
    });
  });

  it("shows tag suggestions after # and selects an existing tag (#222)", () => {
    render(<Composer tagsByName={tags} allTags={allTagsById} />);

    const field = screen.getByLabelText("New task") as HTMLInputElement;
    fireEvent.change(field, { target: { value: "Buy milk #wo" } });
    field.selectionStart = field.selectionEnd = field.value.length;
    fireEvent.select(field);

    expect(screen.getByRole("listbox")).toBeTruthy();
    expect(screen.getByRole("option", { name: /create/i }).getAttribute("aria-selected")).toBe("true");

    fireEvent.keyDown(field, { key: "ArrowDown" });
    expect(screen.getByRole("option", { name: /work/i }).getAttribute("aria-selected")).toBe("true");

    fireEvent.keyDown(field, { key: "Enter" });
    expect(field.value).toBe("Buy milk #work");
  });

  it("confirms create-new on Enter without replacing the fragment (#222)", async () => {
    vi.mocked(api.addTag).mockResolvedValue({ id: "t_novel", name: "novel", color: "#000", priority: 0 });
    render(<Composer tagsByName={tags} allTags={allTagsById} />);

    const field = screen.getByLabelText("New task") as HTMLInputElement;
    fireEvent.change(field, { target: { value: "Buy milk #novel" } });
    field.selectionStart = field.selectionEnd = field.value.length;
    fireEvent.select(field);

    expect(screen.getByRole("listbox")).toBeTruthy();
    fireEvent.keyDown(field, { key: "Enter" });
    expect(field.value).toBe("Buy milk #novel");
    expect(screen.queryByRole("listbox")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(addTask).toHaveBeenCalledTimes(1));
    expect(addTask.mock.calls[0][0].title).toBe("Buy milk");
  });
});
