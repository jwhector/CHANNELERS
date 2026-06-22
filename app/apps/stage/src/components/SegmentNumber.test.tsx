import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { SegmentNumber } from "./SegmentNumber";

test("pads to three and ghosts the same width", () => {
  const { container } = render(<SegmentNumber value={7} />);
  expect(screen.getByLabelText("7")).toBeInTheDocument();
  expect(container.querySelector(".seg-front")!.textContent).toBe("007");
  expect(container.querySelector(".seg-ghost")!.textContent).toBe("888");
});

test("does not truncate numbers wider than the pad", () => {
  const { container } = render(<SegmentNumber value={1234} />);
  expect(container.querySelector(".seg-front")!.textContent).toBe("1234");
  expect(container.querySelector(".seg-ghost")!.textContent).toBe("8888");
});

test("glitch flag adds the class", () => {
  const { container } = render(<SegmentNumber value={1} glitch />);
  expect(container.querySelector(".seg")!.className).toContain("seg-glitch");
});
