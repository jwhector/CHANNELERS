import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { AltarGate } from "./AltarGate";

test("shows CLOSED and fires onToggle(true)", () => {
  const onToggle = vi.fn();
  render(<AltarGate open={false} onToggle={onToggle} />);
  screen.getByRole("button", { name: /altar: closed/i }).click();
  expect(onToggle).toHaveBeenCalledWith(true);
});

test("shows OPEN and fires onToggle(false)", () => {
  const onToggle = vi.fn();
  render(<AltarGate open onToggle={onToggle} />);
  screen.getByRole("button", { name: /altar: open/i }).click();
  expect(onToggle).toHaveBeenCalledWith(false);
});
