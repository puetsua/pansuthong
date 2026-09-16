import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NullableDateInput } from "./NullableDateInput";

describe("NullableDateInput (#217)", () => {
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
