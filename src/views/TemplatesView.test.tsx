import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TemplatesView } from "./TemplatesView";
import { buildIndexes } from "../state/indexes";
import { Document } from "../lib/tauri";

vi.mock("../components/TaskEditor", () => ({
  TaskEditor: ({ creating, kind }: { creating?: boolean; kind?: string }) => (
    <div role="dialog" aria-label={creating && kind === "template" ? "New template" : "editor"} />
  ),
}));

vi.mock("../components/TemplateRow", () => ({
  TemplateRow: () => <div data-testid="template-row" />,
}));

const emptyDoc = (): Document => ({
  version: 2,
  settings: { theme: "auto", sort_order: "priority" },
  tags: [],
  tasks: [],
  template_tasks: [],
});

describe("TemplatesView — new template", () => {
  it("opens the template editor modal instead of creating immediately", () => {
    const doc = emptyDoc();
    render(<TemplatesView doc={doc} indexes={buildIndexes(doc)} />);

    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /new template/i }));
    expect(screen.getByRole("dialog", { name: /new template/i })).toBeTruthy();
  });
});
