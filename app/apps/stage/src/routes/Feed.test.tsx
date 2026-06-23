import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { FeedDisplay } from "./Feed";

test("renders the fed text (as the matrix grid) once a page is fed", () => {
  render(<FeedDisplay text="i never read the terms" capturing={false} connected />);
  expect(screen.getByLabelText("i never read the terms")).toBeInTheDocument();
});

test("shows the idle prompt when nothing has been fed yet", () => {
  render(<FeedDisplay text={null} capturing={false} connected />);
  expect(screen.getByText(/feed a page/i)).toBeInTheDocument();
});
