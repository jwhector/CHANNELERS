import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { ChoreoDisplay } from "./Choreo";

test("renders the current cue", () => {
  render(<ChoreoDisplay cue="Lower your gaze." log={[]} reactToOracle connected onToggle={() => {}} />);
  expect(screen.getByText("Lower your gaze.")).toBeInTheDocument();
});

test("toggling the checkbox fires onToggle with the new value", async () => {
  const onToggle = vi.fn();
  render(<ChoreoDisplay cue="" log={[]} reactToOracle={true} connected={false} onToggle={onToggle} />);
  await userEvent.click(screen.getByRole("checkbox"));
  expect(onToggle).toHaveBeenCalledWith(false);
});
