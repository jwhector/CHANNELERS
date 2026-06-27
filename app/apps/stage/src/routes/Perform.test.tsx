import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { PerformShell } from "./Perform";

const shell = () => (
  <PerformShell
    altar={<div data-testid="altar-region">ALTAR</div>}
    channel={<div data-testid="channel-region">CHANNEL</div>}
    choreo={<div data-testid="choreo-region">CHOREO</div>}
    console={<div data-testid="console-region">CONSOLE</div>}
  />
);
const wrap = (id: string) => screen.getByTestId(id).closest("[data-tabpanel]") as HTMLElement;

test("mounts all four regions", () => {
  render(shell());
  expect(screen.getByTestId("altar-region")).toBeInTheDocument();
  expect(screen.getByTestId("channel-region")).toBeInTheDocument();
  expect(screen.getByTestId("choreo-region")).toBeInTheDocument();
  expect(screen.getByTestId("console-region")).toBeInTheDocument();
});

test("defaults to the altar tab visible, others hidden", () => {
  render(shell());
  expect(wrap("altar-region").hidden).toBe(false);
  expect(wrap("channel-region").hidden).toBe(true);
  expect(wrap("choreo-region").hidden).toBe(true);
  expect(wrap("console-region").hidden).toBe(true);
});

test("clicking a tab foregrounds its region", async () => {
  render(shell());
  await userEvent.click(screen.getByRole("button", { name: /^channel$/i }));
  expect(wrap("altar-region").hidden).toBe(true);
  expect(wrap("channel-region").hidden).toBe(false);
  expect(wrap("choreo-region").hidden).toBe(true);
  expect(wrap("console-region").hidden).toBe(true);
});

test("clicking the console tab foregrounds the console region", async () => {
  render(shell());
  await userEvent.click(screen.getByRole("button", { name: /^console$/i }));
  expect(wrap("altar-region").hidden).toBe(true);
  expect(wrap("console-region").hidden).toBe(false);
});
