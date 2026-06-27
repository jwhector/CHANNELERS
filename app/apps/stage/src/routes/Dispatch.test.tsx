import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { FlowStrip } from "./Dispatch";

test("altar toggle shows CLOSED and fires onToggleAltar(true)", () => {
  const onToggle = vi.fn();
  render(
    <FlowStrip altarOpen={false} altarReady={3} bodyscanIdle={false}
      bodyscanBlocked="none" onToggleAltar={onToggle} />,
  );
  expect(screen.getByText(/altar-ready 3/i)).toBeInTheDocument();
  screen.getByRole("button", { name: /altar: closed/i }).click();
  expect(onToggle).toHaveBeenCalledWith(true);
});

test("flags bodyscan idle with its blocked reason", () => {
  render(
    <FlowStrip altarOpen altarReady={0} bodyscanIdle
      bodyscanBlocked="soaking" onToggleAltar={() => {}} />,
  );
  expect(screen.getByText(/bodyscan idle/i)).toBeInTheDocument();
  expect(screen.getByText(/soaking/i)).toBeInTheDocument();
});
