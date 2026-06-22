import { renderHook, act } from "@testing-library/react";
import { beforeEach, expect, test } from "vitest";
import { useCrtFx } from "./useCrtFx";

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState({}, "", "/intake");
});

test("defaults on", () => {
  expect(renderHook(() => useCrtFx()).result.current.fx).toBe(true);
});

test("?crt=off forces off", () => {
  window.history.replaceState({}, "", "/intake?crt=off");
  expect(renderHook(() => useCrtFx()).result.current.fx).toBe(false);
});

test("toggle flips and persists", () => {
  const { result } = renderHook(() => useCrtFx());
  act(() => result.current.toggle());
  expect(result.current.fx).toBe(false);
  expect(localStorage.getItem("channelers.crt")).toBe("off");
});
