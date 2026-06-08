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
});
