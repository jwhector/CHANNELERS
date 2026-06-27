import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { ExitScreen } from "./Intake";

// #9 — post-intake exit screen: direct the visitor out with a large thematic
// directive; the seven-segment number must NOT reappear here.
test("exit screen directs the visitor out and shows no number", () => {
  render(<ExitScreen />);
  expect(screen.getByText(/step away from the terminal/i)).toBeInTheDocument();
  expect(screen.getByText(/await your summons/i)).toBeInTheDocument();
  // SegmentNumber renders role="img"; the exit screen must not show one.
  expect(screen.queryByRole("img")).toBeNull();
});
