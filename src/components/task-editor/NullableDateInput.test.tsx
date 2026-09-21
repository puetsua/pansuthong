import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NullableDateInput } from "./NullableDateInput";
import { resetLinuxDesktopCacheForTests, primeLinuxDesktopCacheForTests } from "../../lib/useLinuxDesktop";

const platform = vi.hoisted(() => ({
  isLinux: vi.fn().mockResolvedValue(false),
}));

vi.mock("../../lib/platform", () => platform);

describe("NullableDateInput (#217)", () => {
  beforeEach(() => {
    resetLinuxDesktopCacheForTests();
    primeLinuxDesktopCacheForTests(false);
    platform.isLinux.mockResolvedValue(false);
  });

  it("renders an unset text field when value is empty", () => {
    render(<NullableDateInput aria-label="Start Date" value="" onChange={vi.fn()} />);
    const input = screen.getByLabelText("Start Date") as HTMLInputElement;
    expect(input.type).toBe("text");
    expect(input.className).toContain("te-date-unset");
    expect(input.value).toBe("");
  });

  it("accepts a typed ISO date without using type=date while unset", () => {
    const onChange = vi.fn();
    render(<NullableDateInput aria-label="Start Date" value="" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Start Date"), { target: { value: "2026-09-20" } });
    expect(onChange).toHaveBeenCalledWith("2026-09-20");
  });

  it("renders type=date when a value is set", () => {
    render(<NullableDateInput aria-label="Start Date" value="2026-09-20" onChange={vi.fn()} />);
    const input = screen.getByLabelText("Start Date") as HTMLInputElement;
    expect(input.type).toBe("date");
    expect(input.value).toBe("2026-09-20");
  });

  it("clears on Backspace when the whole field is selected (#221)", () => {
    const onChange = vi.fn();
    render(<NullableDateInput aria-label="Due Date" value="2026-09-14" onChange={onChange} />);
    const input = screen.getByLabelText("Due Date") as HTMLInputElement;
    Object.defineProperty(input, "selectionStart", { configurable: true, value: 0 });
    Object.defineProperty(input, "selectionEnd", { configurable: true, value: input.value.length });
    fireEvent.keyDown(input, { key: "Backspace" });
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("clears on Delete when selection APIs are missing (#221 WebKitGTK)", () => {
    const onChange = vi.fn();
    render(<NullableDateInput aria-label="Due Date" value="2026-09-14" onChange={onChange} />);
    const input = screen.getByLabelText("Due Date") as HTMLInputElement;
    Object.defineProperty(input, "selectionStart", { configurable: true, value: null });
    Object.defineProperty(input, "selectionEnd", { configurable: true, value: null });
    fireEvent.keyDown(input, { key: "Delete" });
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("does not clear on Backspace when only part of the date is selected", () => {
    const onChange = vi.fn();
    render(<NullableDateInput aria-label="Due Date" value="2026-09-14" onChange={onChange} />);
    const input = screen.getByLabelText("Due Date") as HTMLInputElement;
    Object.defineProperty(input, "selectionStart", { configurable: true, value: 0 });
    Object.defineProperty(input, "selectionEnd", { configurable: true, value: 2 });
    fireEvent.keyDown(input, { key: "Backspace" });
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("NullableDateInput Linux in-DOM picker (#237)", () => {
  beforeEach(() => {
    resetLinuxDesktopCacheForTests();
    primeLinuxDesktopCacheForTests(true);
    platform.isLinux.mockResolvedValue(true);
  });

  it("never renders type=date and opens an in-DOM popover", () => {
    render(<NullableDateInput aria-label="Due Date" value="2026-09-25" onChange={vi.fn()} />);
    const input = screen.getByLabelText("Due Date") as HTMLInputElement;
    expect(input.type).toBe("text");
    expect(input.getAttribute("type")).toBe("text");
    fireEvent.click(input);
    expect(screen.getByRole("dialog", { name: "Due Date" })).toBeTruthy();
  });

  it("closes the due popover when start field is opened", () => {
    const { rerender } = render(
      <>
        <NullableDateInput aria-label="Due Date" value="2026-09-25" onChange={vi.fn()} />
        <NullableDateInput aria-label="Start Date" value="" onChange={vi.fn()} />
      </>,
    );
    fireEvent.click(screen.getByLabelText("Due Date"));
    expect(screen.getByRole("dialog", { name: "Due Date" })).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Start Date"));
    expect(screen.queryByRole("dialog", { name: "Due Date" })).toBeNull();
    expect(screen.getByRole("dialog", { name: "Start Date" })).toBeTruthy();
    rerender(<></>);
  });
});
