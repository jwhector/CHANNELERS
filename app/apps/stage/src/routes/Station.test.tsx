import { render, screen } from "@testing-library/react";
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
