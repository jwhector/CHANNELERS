import { render, screen, fireEvent } from "@testing-library/react";
import { expect, test, vi, beforeEach } from "vitest";

// Hoisted so the vi.mock factory can reference it (vi.mock is hoisted above module scope).
const { speakMock, speakSequenceMock } = vi.hoisted(() => ({ speakMock: vi.fn(), speakSequenceMock: vi.fn() }));
vi.mock("../lib/speech", () => ({ speak: speakMock, speakSequence: speakSequenceMock, stopSpeaking: vi.fn() }));

import { PluribusBroadcast } from "./PluribusBroadcast";

beforeEach(() => {
  speakMock.mockClear();
  speakSequenceMock.mockClear();
});

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

test("single-channel mode shows one output picker and calls speak()", () => {
  render(<PluribusBroadcast numbers={[3]} storageKey="out.test" />);
  expect(screen.getAllByRole("combobox")).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: /PLURIBUS BROADCAST/i }));
  expect(speakMock).toHaveBeenCalledTimes(1);
  expect(speakSequenceMock).not.toHaveBeenCalled();
});

test("dual-channel mode adds an in-ear picker and splits the broadcast into two sequential clips", () => {
  render(<PluribusBroadcast numbers={[3, 7]} storageKey="out.altar.room" earStorageKey="out.altar.ear" />);
  // room + in-ear output pickers
  expect(screen.getAllByRole("combobox")).toHaveLength(2);
  expect(screen.getByText(/in-ear/i)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /PLURIBUS BROADCAST/i }));
  expect(speakMock).not.toHaveBeenCalled();
  expect(speakSequenceMock).toHaveBeenCalledTimes(1);
  const clips = speakSequenceMock.mock.calls[0][0] as Array<{ text: string }>;
  expect(clips).toHaveLength(2);
  expect(clips[0].text).toMatch(/INCOMING BROADCAST/); // countdown → room
  expect(clips[1].text).toMatch(/USERS 3 and 7/); // numbers → in-ear
});
