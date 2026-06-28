import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { CalledGate } from "./CalledGate";
import { api } from "../lib/api";
import type { Slot, SlotOccupant } from "@channelers/shared";

vi.mock("../lib/api", () => ({
  api: { arrive: vi.fn(), getByNumber: vi.fn(), dispatch: { repool: vi.fn(), confirm: vi.fn() } },
}));

const slot = (occupant?: SlotOccupant): Slot => ({
  id: "intake-0",
  station: "intake",
  online: true,
  occupant,
});
const called = (number: number): SlotOccupant => ({
  visitorId: "v1",
  number,
  phase: "called",
  since: "",
});
const pending = (number: number): SlotOccupant => ({
  visitorId: "v1",
  number,
  phase: "pending",
  since: "",
});

test("crt skin: no title, STANDBY when idle", () => {
  render(<CalledGate station="intake" title="Intake" connected skin="crt" slot={slot()} onArrived={() => {}} />);
  expect(screen.queryByRole("heading", { name: "Intake" })).toBeNull();
  expect(screen.getByText(/standby/i)).toBeInTheDocument();
});

test("crt skin: called shows the number and an I AM button", () => {
  render(<CalledGate station="intake" title="Intake" connected skin="crt" slot={slot(called(17))} onArrived={() => {}} />);
  expect(screen.getByLabelText("17")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "I AM" })).toBeInTheDocument();
});

test("default skin still shows the title and Confirm arrival", () => {
  render(<CalledGate station="intake" title="Intake" connected slot={slot(called(9))} onArrived={() => {}} />);
  expect(screen.getByRole("heading", { name: "Intake" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /confirm arrival/i })).toBeInTheDocument();
});

test("operator mode: called shows Confirm arrival + Release, firing arrive/repool", async () => {
  render(
    <CalledGate
      station="altar" title="Altar" connected confirmedBy="operator"
      slot={slot(called(12))} onArrived={() => {}}
    />,
  );
  expect(screen.getByText("#12")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /confirm arrival/i }));
  expect(api.arrive).toHaveBeenCalledWith("v1");
  expect(api.dispatch.confirm).not.toHaveBeenCalled(); // already called → no confirm-call step
  await userEvent.click(screen.getByRole("button", { name: /release/i }));
  expect(api.dispatch.repool).toHaveBeenCalledWith("v1");
});

test("operator mode: a pending occupant can be admitted in one tap — confirm call then arrive", async () => {
  render(
    <CalledGate
      station="altar" title="Altar" connected confirmedBy="operator"
      slot={slot(pending(14))} onArrived={() => {}}
    />,
  );
  expect(screen.getByText("#14")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /confirm arrival/i }));
  expect(api.dispatch.confirm).toHaveBeenCalledWith("v1"); // pending → called
  expect(api.arrive).toHaveBeenCalledWith("v1"); // called → in_progress
});

test("visitor mode: a pending occupant shows nothing to confirm (waits to be called)", () => {
  render(<CalledGate station="intake" title="Intake" connected slot={slot(pending(14))} onArrived={() => {}} />);
  expect(screen.queryByRole("button", { name: /confirm arrival/i })).toBeNull();
});

test("default skin renders the optional operator extra slot", () => {
  render(
    <CalledGate
      station="altar" title="Altar" connected confirmedBy="operator"
      slot={slot()} onArrived={() => {}} extra={<div>STANDBY CONTROLS</div>}
    />,
  );
  expect(screen.getByText("STANDBY CONTROLS")).toBeInTheDocument();
});
