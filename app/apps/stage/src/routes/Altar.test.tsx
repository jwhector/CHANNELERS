import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi, beforeEach } from "vitest";

// Spies created before vi.mock factories run (vi.mock is hoisted above imports).
const { verifyPose, setPersona } = vi.hoisted(() => ({
  verifyPose: vi.fn(() => Promise.resolve()),
  setPersona: vi.fn(() => Promise.resolve()),
}));
vi.mock("../lib/api", () => ({ api: { verifyPose, setPersona } }));
vi.mock("../lib/pose/usePoseLandmarker", () => ({
  usePoseLandmarker: () => ({ videoRef: { current: null }, status: "idle", error: null, start: vi.fn() }),
}));
vi.mock("../lib/devices", () => ({
  useDevices: () => ({ deviceId: "", devices: [], setDeviceId: vi.fn(), needsPermission: false, enableLabels: vi.fn() }),
}));

import { Gate } from "./Altar";
import type { VisitorProfile } from "@channelers/shared";

const visitor = {
  id: "v1",
  number: 7,
  location: { state: "in_progress" },
  survey: { name: "Ada" },
} as unknown as VisitorProfile;

beforeEach(() => verifyPose.mockClear());

test("override is the primary action and calls verifyPose", async () => {
  render(<Gate visitor={visitor} connected showCamera={false} />);
  await userEvent.click(screen.getByRole("button", { name: /unlock \(override\)/i }));
  expect(verifyPose).toHaveBeenCalledWith("v1");
});

test("showCamera=false hides all camera UI", () => {
  render(<Gate visitor={visitor} connected showCamera={false} />);
  expect(screen.queryByRole("button", { name: /verify by camera/i })).toBeNull();
  expect(screen.queryByRole("button", { name: /start camera/i })).toBeNull();
});

test("default offers an opt-in camera toggle, collapsed", () => {
  render(<Gate visitor={visitor} connected />);
  expect(screen.getByRole("button", { name: /verify by camera/i })).toBeInTheDocument();
  // collapsed until toggled — the camera controls are not in the DOM yet
  expect(screen.queryByRole("button", { name: /start camera/i })).toBeNull();
});
