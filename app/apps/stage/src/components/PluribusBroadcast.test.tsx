import { render, screen, fireEvent } from "@testing-library/react";
import { expect, test, vi, beforeEach } from "vitest";

// Hoisted so the vi.mock factory can reference it (vi.mock is hoisted above module scope).
const { speakMock } = vi.hoisted(() => ({ speakMock: vi.fn() }));
vi.mock("../lib/speech", () => ({ speak: speakMock, stopSpeaking: vi.fn() }));

import { PluribusBroadcast } from "./PluribusBroadcast";

beforeEach(() => speakMock.mockClear());

test("shows a speed dial and broadcasts at the chosen rate", () => {
  render(<PluribusBroadcast numbers={[3, 7]} storageKey="out.test" rate={0.7} onChangeRate={() => {}} />);
  // The speed dial (SpeedPicker) renders its ×N readout.
  expect(screen.getByText(/0\.70×/)).toBeInTheDocument();
  // Broadcasting threads the chosen rate through to speak().
  fireEvent.click(screen.getByRole("button", { name: /PLURIBUS BROADCAST/i }));
  expect(speakMock).toHaveBeenCalledTimes(1);
  expect(speakMock.mock.calls[0][1]).toMatchObject({ rate: 0.7 });
});

test("dragging the speed dial fires onChangeRate", () => {
  const onChangeRate = vi.fn();
  render(<PluribusBroadcast numbers={[3]} storageKey="out.test" rate={0.7} onChangeRate={onChangeRate} />);
  fireEvent.change(screen.getByRole("slider"), { target: { value: "1.0" } });
  expect(onChangeRate).toHaveBeenCalledWith(1);
});

test("with no rate wiring there is no speed dial (backward-compatible)", () => {
  render(<PluribusBroadcast numbers={[3]} storageKey="out.test" />);
  expect(screen.queryByRole("slider")).toBeNull();
});
