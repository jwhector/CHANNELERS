import { render, screen, act } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import type { Slot, SlotOccupant, WsServerMsg } from "@channelers/shared";
import type { Landmark } from "../lib/pose/landmarks";
import { landmarksToAngles, poseSimilarity } from "../lib/pose/angles";

// Mock the live hooks so the camera path is inert; capture the callbacks the
// component registers so tests can drive frames + relayed commands directly.
const presence = { current: { connected: true, slot: undefined as Slot | undefined } };
let onFrame: ((lms: Landmark[] | null, tMs: number) => void) | null = null;
let onMessage: ((m: WsServerMsg) => void) | null = null;

const dev = vi.hoisted(() => ({ setDeviceId: vi.fn(), refresh: vi.fn() }));

vi.mock("../lib/useStationPresence", () => ({ useStationPresence: () => presence.current }));
vi.mock("../lib/useBrainSocket", () => ({
  useBrainSocket: (cb: (m: WsServerMsg) => void) => { onMessage = cb; return { connected: true, send: () => {} }; },
}));
vi.mock("../lib/pose/usePoseLandmarker", () => ({
  usePoseLandmarker: (cb: (lms: Landmark[] | null, tMs: number) => void) => {
    onFrame = cb;
    return { videoRef: { current: null }, status: "running", error: null, start: vi.fn() };
  },
}));
vi.mock("../lib/devices", () => ({
  useDevices: () => ({
    devices: [{ deviceId: "cam-a", label: "Front" }, { deviceId: "cam-b", label: "Overhead" }],
    deviceId: "cam-a", setDeviceId: dev.setDeviceId, needsPermission: false, enableLabels: vi.fn(), refresh: dev.refresh,
  }),
}));
vi.mock("../lib/api", () => ({
  api: { enrollPose: vi.fn().mockResolvedValue({}), reportBodyscanCameras: vi.fn().mockResolvedValue({}) },
}));

import { BodyScan } from "./BodyScan";
import { api } from "../lib/api";

const slot = (occupant?: SlotOccupant): Slot => ({ id: "bodyscan-0", station: "bodyscan", online: true, occupant });
const occ = (number: number, phase: SlotOccupant["phase"]): SlotOccupant => ({ visitorId: `v${number}`, number, phase, since: "" });

// 33 BlazePose landmarks at distinct positions; coverage == the given visibility
// (every joint weight is the min visibility of its triple), so vis 1 ⇒ framed, low ⇒ not.
const landmarks = (visibility: number): Landmark[] =>
  Array.from({ length: 33 }, (_, i) => ({ x: 0.1 + (i % 7) * 0.1, y: 0.1 + Math.floor(i / 7) * 0.08, z: 0, visibility }));

// A clearly different shape: every landmark on one vertical line, so the joint
// angles collapse to straight/zero and poseSimilarity vs landmarks() is < 0.7.
// Used to "break" the enrolled pose and to test a non-matching repeat.
const lineLandmarks = (visibility: number): Landmark[] =>
  Array.from({ length: 33 }, (_, i) => ({ x: 0.5, y: 0.05 + i * 0.025, z: 0, visibility }));

const captureCmd = (visitorId: string): WsServerMsg =>
  ({ kind: "station.cmd", station: "bodyscan", action: "capture", visitorId });

beforeEach(() => { vi.clearAllMocks(); onFrame = null; onMessage = null; });

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

test("not armed: a still, framed pose does NOT capture (gated behind the operator)", () => {
  presence.current = { connected: true, slot: slot(occ(7, "in_progress")) };
  render(<BodyScan />);
  const lms = landmarks(1);
  act(() => onFrame!(lms, 0));
  act(() => onFrame!(lms, 4000));
  expect(api.enrollPose).not.toHaveBeenCalled();
});

test("repeat-to-confirm: enroll, break the pose, re-form it, then persist", async () => {
  presence.current = { connected: true, slot: slot(occ(7, "in_progress")) };
  render(<BodyScan />);
  const a = landmarks(1);
  const b = lineLandmarks(1);
  act(() => onFrame!(a, 0));                 // establish framing + prev vector
  act(() => onMessage!(captureCmd("v7")));   // operator arms enroll
  act(() => onFrame!(a, 100));               // enroll hold starts
  act(() => onFrame!(a, 3700));              // > RECORD_SEC → capture pose A, enter confirm
  expect(api.enrollPose).not.toHaveBeenCalled(); // NOT saved yet
  act(() => onFrame!(b, 3800));              // similarity < BREAK_THRESH → pose broken
  act(() => onFrame!(a, 3900));              // re-forming: motion high (prev=b) → not still yet
  act(() => onFrame!(a, 4000));              // motion settles → confirm hold starts
  await act(async () => { onFrame!(a, 5600); }); // > CONFIRM_SEC → persist
  expect(api.enrollPose).toHaveBeenCalledTimes(1);
  expect(api.enrollPose).toHaveBeenCalledWith(
    "v7",
    expect.objectContaining({ angles: expect.any(Array), weights: expect.any(Array) }),
  );
});

test("the first hold captures but does not persist — it prompts for the repeat", () => {
  presence.current = { connected: true, slot: slot(occ(7, "in_progress")) };
  render(<BodyScan />);
  const a = landmarks(1);
  act(() => onFrame!(a, 0));
  act(() => onMessage!(captureCmd("v7")));
  act(() => onFrame!(a, 100));
  act(() => onFrame!(a, 3700)); // enroll completes → confirm
  expect(api.enrollPose).not.toHaveBeenCalled();
  expect(screen.getByText(/release, then form it again/i)).toBeInTheDocument();
});

test("holding the pose continuously (never breaking) never confirms", () => {
  presence.current = { connected: true, slot: slot(occ(7, "in_progress")) };
  render(<BodyScan />);
  const a = landmarks(1);
  act(() => onFrame!(a, 0));
  act(() => onMessage!(captureCmd("v7")));
  act(() => onFrame!(a, 100));
  act(() => onFrame!(a, 3700));  // → confirm; similarity to A stays 1, never < BREAK_THRESH
  act(() => onFrame!(a, 5000));
  act(() => onFrame!(a, 8000));
  expect(api.enrollPose).not.toHaveBeenCalled();
});

test("a non-matching repeat does not persist", () => {
  presence.current = { connected: true, slot: slot(occ(7, "in_progress")) };
  render(<BodyScan />);
  const a = landmarks(1);
  const b = lineLandmarks(1);
  expect(poseSimilarity(landmarksToAngles(a), landmarksToAngles(b))).toBeLessThan(0.7); // precondition
  act(() => onFrame!(a, 0));
  act(() => onMessage!(captureCmd("v7")));
  act(() => onFrame!(a, 100));
  act(() => onFrame!(a, 3700));  // → confirm
  act(() => onFrame!(b, 3800));  // breaks (sim < 0.7)
  act(() => onFrame!(b, 3900));  // motion settles, but sim(A,B) < MATCH_THRESH
  act(() => onFrame!(b, 6000));  // held well past CONFIRM_SEC → still must not save
  expect(api.enrollPose).not.toHaveBeenCalled();
});

test("armed but out of frame: the hold never completes", () => {
  presence.current = { connected: true, slot: slot(occ(7, "in_progress")) };
  render(<BodyScan />);
  const lms = landmarks(0.2); // coverage 0.2 < FRAME_ENTER (0.65)
  act(() => onFrame!(lms, 0));
  act(() => onMessage!(captureCmd("v7")));
  act(() => onFrame!(lms, 100));
  act(() => onFrame!(lms, 4000));
  expect(api.enrollPose).not.toHaveBeenCalled();
});

test("a second capture tap toggles off, so a held pose no longer captures", () => {
  presence.current = { connected: true, slot: slot(occ(7, "in_progress")) };
  render(<BodyScan />);
  const lms = landmarks(1);
  act(() => onFrame!(lms, 0));
  act(() => onMessage!(captureCmd("v7"))); // arm
  act(() => onMessage!(captureCmd("v7"))); // toggle off
  act(() => onFrame!(lms, 100));
  act(() => onFrame!(lms, 4000));
  expect(api.enrollPose).not.toHaveBeenCalled();
});

const boundSlot = (kioskId: string, occupant?: SlotOccupant): Slot => ({ ...slot(occupant), kioskId });

test("reports the kiosk's cameras to the brain (even in standby)", () => {
  presence.current = { connected: true, slot: boundSlot("kioskCam", undefined) };
  render(<BodyScan />);
  expect(api.reportBodyscanCameras).toHaveBeenCalledWith(
    "kioskCam",
    [{ id: "cam-a", label: "Front" }, { id: "cam-b", label: "Overhead" }],
    "cam-a",
  );
});

test("a set-camera command for this kiosk switches the camera", () => {
  presence.current = { connected: true, slot: boundSlot("kioskCam", undefined) };
  render(<BodyScan />);
  act(() => onMessage!({ kind: "station.cmd", station: "bodyscan", action: "set-camera", kioskId: "kioskCam", deviceId: "cam-b" }));
  expect(dev.setDeviceId).toHaveBeenCalledWith("cam-b");
});

test("ignores a set-camera command for a different kiosk", () => {
  presence.current = { connected: true, slot: boundSlot("kioskCam", undefined) };
  render(<BodyScan />);
  act(() => onMessage!({ kind: "station.cmd", station: "bodyscan", action: "set-camera", kioskId: "other-kiosk", deviceId: "cam-b" }));
  expect(dev.setDeviceId).not.toHaveBeenCalled();
});
