import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import type { Slot, SlotOccupant } from "@channelers/shared";

// Mock the live hooks so the camera path is inert and view-selection is what we assert.
const presence = { current: { connected: true, slot: undefined as Slot | undefined } };
vi.mock("../lib/useStationPresence", () => ({ useStationPresence: () => presence.current }));
vi.mock("../lib/useBrainSocket", () => ({ useBrainSocket: () => ({ connected: true, send: () => {} }) }));
vi.mock("../lib/pose/usePoseLandmarker", () => ({
  usePoseLandmarker: () => ({ videoRef: { current: null }, status: "running", error: null, start: vi.fn() }),
}));
vi.mock("../lib/devices", () => ({
  useDevices: () => ({ devices: [], deviceId: undefined, setDeviceId: () => {}, needsPermission: false, enableLabels: () => {} }),
}));

import { BodyScan } from "./BodyScan";

const slot = (occupant?: SlotOccupant): Slot => ({ id: "bodyscan-0", station: "bodyscan", online: true, occupant });
const occ = (number: number, phase: SlotOccupant["phase"]): SlotOccupant => ({ visitorId: `v${number}`, number, phase, since: "" });

test("dim standby when no occupant", () => {
  presence.current = { connected: true, slot: slot(undefined) };
  render(<BodyScan />);
  expect(screen.getByText(/awaiting designation/i)).toBeInTheDocument();
});

test("shows the called number before presence is confirmed", () => {
  presence.current = { connected: true, slot: slot(occ(7, "called")) };
  render(<BodyScan />);
  expect(screen.getByLabelText("7")).toBeInTheDocument(); // SegmentNumber aria-label
  expect(screen.getByText(/now serving/i)).toBeInTheDocument();
});

test("renders the camera surface once in progress, with no controls", () => {
  presence.current = { connected: true, slot: slot(occ(7, "in_progress")) };
  const { container } = render(<BodyScan />);
  expect(container.querySelector(".bodyscan-cam")).not.toBeNull();
  expect(screen.queryByRole("button", { name: /record|start camera|capture/i })).toBeNull();
});
