import { render, screen, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { DEFAULT_CHOREO_CONFIG } from "@channelers/shared";

// Capture the socket message handler so a test can push server messages into the live component.
const h = vi.hoisted(() => ({ onMessage: undefined as undefined | ((m: any) => void), send: vi.fn() }));
vi.mock("../lib/useBrainSocket", () => ({
  useBrainSocket: (onMessage: (m: any) => void) => {
    h.onMessage = onMessage;
    return { connected: true, send: h.send };
  },
}));

const speech = vi.hoisted(() => ({ speak: vi.fn(), speakSequence: vi.fn(), stopSpeaking: vi.fn() }));
vi.mock("../lib/speech", () => speech);

const apiMock = vi.hoisted(() => ({ choreo: { config: vi.fn(), setConfig: vi.fn() } }));
vi.mock("../lib/api", () => ({ api: apiMock }));

vi.mock("../lib/devices", () => ({
  useDevices: () => ({
    devices: [], deviceId: "", setDeviceId: vi.fn(), needsPermission: false, enableLabels: vi.fn(), refresh: vi.fn(),
  }),
}));
vi.mock("../lib/playbackRate", () => ({ usePlaybackRate: () => ({ rate: 0.7, setRate: vi.fn() }), DEFAULT_PLAYBACK_RATE: 0.7 }));
vi.mock("../components/DevicePicker", () => ({ DevicePicker: () => null }));
vi.mock("../components/SpeedPicker", () => ({ SpeedPicker: () => null }));

import { Choreo } from "./Choreo";

beforeEach(() => {
  speech.speak.mockReset();
  speech.speakSequence.mockReset();
  apiMock.choreo.config.mockResolvedValue({ ...DEFAULT_CHOREO_CONFIG });
  apiMock.choreo.setConfig.mockResolvedValue({ ...DEFAULT_CHOREO_CONFIG });
});
afterEach(() => vi.clearAllMocks());

test("a cue flagged prepareToChannel is voiced as a sequence chased by 'Prepare to channel.'", async () => {
  render(<Choreo />);
  await waitFor(() => expect(h.onMessage).toBeTypeOf("function"));
  act(() => h.onMessage!({ kind: "choreo.done", sessionId: "a", text: "Reach forward.", prepareToChannel: true }));
  await waitFor(() => expect(speech.speakSequence).toHaveBeenCalled());
  const [clips] = speech.speakSequence.mock.calls[0];
  expect(clips[0].text).toBe("Reach forward.");
  expect(clips[1]).toEqual({ text: "Prepare to channel." });
  expect(speech.speak).not.toHaveBeenCalled();
});

test("an ordinary cue is voiced with speak(), not a sequence", async () => {
  render(<Choreo />);
  await waitFor(() => expect(h.onMessage).toBeTypeOf("function"));
  act(() => h.onMessage!({ kind: "choreo.done", sessionId: "a", text: "Lower your gaze." }));
  await waitFor(() => expect(speech.speak).toHaveBeenCalled());
  expect(speech.speakSequence).not.toHaveBeenCalled();
});

test("turning 'mimic oracle' off clears the channelling banner immediately", async () => {
  apiMock.choreo.config.mockResolvedValue({ ...DEFAULT_CHOREO_CONFIG, mimicManual: true });
  render(<Choreo />);
  const box = await screen.findByRole("checkbox", { name: /mimic oracle/i });
  await waitFor(() => expect(box).toBeChecked());

  act(() => h.onMessage!({ kind: "choreo.mimic", sessionId: "a", text: "The forms are processing.", archetype: "tree" }));
  expect(screen.getByText(/channelling/i)).toBeInTheDocument();

  await userEvent.click(box); // operator unchecks — must not wait for the next cue to clear
  expect(screen.queryByText(/channelling/i)).not.toBeInTheDocument();
});
