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
});
