import { render, screen, fireEvent } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { StationOpsView } from "./Station";
import type { Slot, DispatchFlag } from "@channelers/shared";

const calledSlot = (n: number, flags?: DispatchFlag[]): Slot => ({
  id: "bodyscan-0",
  station: "bodyscan",
  online: true,
  occupant: { visitorId: `v${n}`, number: n, phase: "called", since: "", flags },
});

test("lists called participants and fires onArrive with the visitor id", () => {
  const onArrive = vi.fn();
  render(
    <StationOpsView
      station="bodyscan" connected called={[calledSlot(42)]} inProgress={[]}
      busyId={null} onArrive={onArrive} onRelease={() => {}}
    />,
  );
  expect(screen.getByText("#42")).toBeInTheDocument();
  screen.getByRole("button", { name: /confirm arrival/i }).click();
  expect(onArrive).toHaveBeenCalledWith("v42");
});

test("shows a no-show warning when the occupant is flagged", () => {
  render(
    <StationOpsView
      station="bodyscan" connected
      called={[calledSlot(7, [{ type: "no-show", since: "" }])]} inProgress={[]}
      busyId={null} onArrive={() => {}} onRelease={() => {}}
    />,
  );
  expect(screen.getByText(/no-show/i)).toBeInTheDocument();
});

test("a paper in-progress occupant shows Done and fires onComplete", () => {
  const onComplete = vi.fn();
  const slot: Slot = {
    id: "paper-0", station: "paper", online: true,
    occupant: { visitorId: "v9", number: 9, phase: "in_progress", since: "" },
  };
  render(
    <StationOpsView
      station="paper" connected called={[]} inProgress={[slot]}
      busyId={null} onArrive={() => {}} onRelease={() => {}} onComplete={onComplete} />,
  );
  screen.getByRole("button", { name: /done/i }).click();
  expect(onComplete).toHaveBeenCalledWith("v9");
});

test("an offering in-progress occupant shows Done (manual early release)", () => {
  const onComplete = vi.fn();
  const slot: Slot = {
    id: "offering-0", station: "offering", online: true,
    occupant: { visitorId: "v7", number: 7, phase: "in_progress", since: "" },
  };
  render(
    <StationOpsView
      station="offering" connected called={[]} inProgress={[slot]}
      dwellMs={300_000} busyId={null}
      onArrive={() => {}} onRelease={() => {}} onComplete={onComplete} />,
  );
  screen.getByRole("button", { name: /done/i }).click();
  expect(onComplete).toHaveBeenCalledWith("v7");
});

test("an in-progress occupant with no onComplete shows no Done button", () => {
  const slot: Slot = {
    id: "bodyscan-0", station: "bodyscan", online: true,
    occupant: { visitorId: "v1", number: 1, phase: "in_progress", since: "" },
  };
  render(
    <StationOpsView
      station="bodyscan" connected called={[]} inProgress={[slot]}
      busyId={null} onArrive={() => {}} onRelease={() => {}} />,
  );
  expect(screen.queryByRole("button", { name: /done/i })).toBeNull();
});

test("bodyscan in-progress row shows Capture pose and fires onCapture", () => {
  const onCapture = vi.fn();
  const slot: Slot = {
    id: "bodyscan-0", station: "bodyscan", online: true,
    occupant: { visitorId: "v9", number: 9, phase: "in_progress", since: "" },
  };
  render(
    <StationOpsView
      station="bodyscan" connected called={[]} inProgress={[slot]}
      busyId={null} onArrive={() => {}} onRelease={() => {}} onCapture={onCapture} />,
  );
  screen.getByRole("button", { name: /capture pose/i }).click();
  expect(onCapture).toHaveBeenCalledWith("v9");
});

test("no Capture button when onCapture is not provided", () => {
  const slot: Slot = {
    id: "bodyscan-0", station: "bodyscan", online: true,
    occupant: { visitorId: "v9", number: 9, phase: "in_progress", since: "" },
  };
  render(
    <StationOpsView
      station="bodyscan" connected called={[]} inProgress={[slot]}
      busyId={null} onArrive={() => {}} onRelease={() => {}} />,
  );
  expect(screen.queryByRole("button", { name: /capture pose/i })).toBeNull();
});

test("bodyscan camera picker lists reported cameras and fires onSetCamera", () => {
  const onSetCamera = vi.fn();
  const camSlot: Slot = {
    id: "bodyscan-0", station: "bodyscan", online: true, kioskId: "kioskCam",
    cameras: [{ id: "cam-a", label: "Front" }, { id: "cam-b", label: "Overhead" }],
    activeCameraId: "cam-a",
  };
  render(
    <StationOpsView
      station="bodyscan" connected called={[]} inProgress={[]} cameraSlots={[camSlot]}
      busyId={null} onArrive={() => {}} onRelease={() => {}} onSetCamera={onSetCamera} />,
  );
  expect(screen.getByRole("option", { name: "Front" })).toBeInTheDocument();
  expect(screen.getByRole("option", { name: "Overhead" })).toBeInTheDocument();
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "cam-b" } });
  expect(onSetCamera).toHaveBeenCalledWith("kioskCam", "cam-b");
});

test("a called row shows the no-show countdown when noShowMs is provided", () => {
  const since = "2026-06-21T00:00:00.000Z";
  const slot: Slot = {
    id: "bodyscan-0", station: "bodyscan", online: true,
    occupant: { visitorId: "v1", number: 5, phase: "called", since },
  };
  render(
    <StationOpsView
      station="bodyscan" connected called={[slot]} inProgress={[]}
      noShowMs={90_000} now={Date.parse(since) + 30_000}
      busyId={null} onArrive={() => {}} onRelease={() => {}}
    />,
  );
  expect(screen.getByText(/no-show in 1:00/)).toBeInTheDocument();
});
