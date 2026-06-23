import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { ChoreoDisplay } from "./Choreo";

test("renders the current cue", () => {
  render(
    <ChoreoDisplay cue="Lower your gaze." log={[]} reactToOracle connected
      speakCues onToggleSpeak={() => {}} onToggle={() => {}} />,
  );
  expect(screen.getByText("Lower your gaze.")).toBeInTheDocument();
});

test("toggling 'react to oracle' fires onToggle with the new value", async () => {
  const onToggle = vi.fn();
  render(
    <ChoreoDisplay cue="" log={[]} reactToOracle connected={false}
      speakCues onToggleSpeak={() => {}} onToggle={onToggle} />,
  );
  await userEvent.click(screen.getByRole("checkbox", { name: /react to oracle/i }));
  expect(onToggle).toHaveBeenCalledWith(false);
});

test("toggling 'speak cues' fires onToggleSpeak with the new value", async () => {
  const onToggleSpeak = vi.fn();
  render(
    <ChoreoDisplay cue="" log={[]} reactToOracle connected={false}
      speakCues onToggleSpeak={onToggleSpeak} onToggle={() => {}} />,
  );
  await userEvent.click(screen.getByRole("checkbox", { name: /speak cues/i }));
  expect(onToggleSpeak).toHaveBeenCalledWith(false);
});
