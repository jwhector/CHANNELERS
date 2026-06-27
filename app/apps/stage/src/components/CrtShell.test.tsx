import { render, screen } from "@testing-library/react";
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

// The CRT FX toggle button is currently commented out in CrtShell (bezel
// cleanup, commit "Board changes"). The toggle behaviour itself is covered by
// useCrtFx.test.ts ("toggle flips and persists"). If the button is reinstated,
// re-add a test that clicks it and asserts data-crt-fx flips to "off".
