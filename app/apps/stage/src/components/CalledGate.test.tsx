import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { CalledGate } from "./CalledGate";
import type { Slot, SlotOccupant } from "@channelers/shared";

vi.mock("../lib/api", () => ({ api: { arrive: vi.fn(), getByNumber: vi.fn() } }));

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
