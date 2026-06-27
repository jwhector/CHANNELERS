import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { FlowStrip } from "./Dispatch";

test("shows the altar-ready buffer and has no altar gate toggle", () => {
  render(<FlowStrip altarReady={3} bodyscanIdle={false} bodyscanBlocked="none" />);
  expect(screen.getByText(/altar-ready 3/i)).toBeInTheDocument();
  // The altar OPEN/CLOSED gate now lives on /console, not the dispatch flow strip.
  expect(screen.queryByRole("button", { name: /altar:/i })).not.toBeInTheDocument();
});

test("flags bodyscan idle with its blocked reason", () => {
  render(<FlowStrip altarReady={0} bodyscanIdle bodyscanBlocked="soaking" />);
  expect(screen.getByText(/bodyscan idle/i)).toBeInTheDocument();
  expect(screen.getByText(/soaking/i)).toBeInTheDocument();
});
