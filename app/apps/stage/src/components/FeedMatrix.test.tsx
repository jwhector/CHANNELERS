import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { FeedMatrix } from "./FeedMatrix";

test("exposes the full text via aria-label and shows the first word readable at t=0", () => {
  render(<FeedMatrix text="hi yo" nowMs={0} />);
  const grid = screen.getByLabelText("hi yo");
  expect(grid).toBeInTheDocument();
  expect(grid.textContent).toContain("hi"); // word 0 is readable letters
});

test("renders only flipping binary once every word has converted", () => {
  render(<FeedMatrix text="hi yo" nowMs={9_999_999} />);
  const grid = screen.getByLabelText("hi yo");
  const txt = grid.textContent ?? "";
  expect(/^[01\s]+$/.test(txt)).toBe(true); // all glyphs are 0/1 (spaces between words)
  expect(/[01]/.test(txt)).toBe(true);
});

test("normalizes whitespace in the aria-label", () => {
  render(<FeedMatrix text="  burn   it  " nowMs={0} />);
  expect(screen.getByLabelText("burn it")).toBeInTheDocument();
});
