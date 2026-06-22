import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test } from "vitest";
import { CrtShell } from "./CrtShell";

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState({}, "", "/intake");
});

test("renders children and defaults FX on", () => {
  render(<CrtShell><p>hello</p></CrtShell>);
  expect(screen.getByText("hello")).toBeInTheDocument();
  expect(document.querySelector(".crt")!.getAttribute("data-crt-fx")).toBe("on");
});

test("toggle button flips the FX attribute", async () => {
  render(<CrtShell><p>x</p></CrtShell>);
  await userEvent.click(screen.getByRole("button", { name: /crt/i }));
  expect(document.querySelector(".crt")!.getAttribute("data-crt-fx")).toBe("off");
});
