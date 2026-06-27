import { render, screen } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { SpeedPicker } from "./SpeedPicker";

test("shows the current rate as a ×N readout", () => {
  render(<SpeedPicker value={0.7} onChange={() => {}} />);
  expect(screen.getByText(/0\.70×/)).toBeInTheDocument();
});

test("dragging the slider fires onChange with the new rate", () => {
  const onChange = vi.fn();
  render(<SpeedPicker value={0.7} onChange={onChange} />);
  fireEvent.change(screen.getByRole("slider"), { target: { value: "0.85" } });
  expect(onChange).toHaveBeenCalledWith(0.85);
});
