import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { CalledGate } from "./CalledGate";
import { api } from "../lib/api";
import type { Slot, SlotOccupant } from "@channelers/shared";

vi.mock("../lib/api", () => ({
  api: { arrive: vi.fn(), getByNumber: vi.fn(), dispatch: { repool: vi.fn() } },
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
  await userEvent.click(screen.getByRole("button", { name: /release/i }));
  expect(api.dispatch.repool).toHaveBeenCalledWith("v1");
});
