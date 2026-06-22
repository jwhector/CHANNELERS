import { render, screen, fireEvent } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { DEFAULT_TUNING, PRESETS } from "@channelers/shared";
import { AlteredStateConsole } from "./AlteredStateConsole";

test("clicking a preset loads its verbatim values", () => {
  const onChange = vi.fn();
  render(<AlteredStateConsole tuning={DEFAULT_TUNING} onChange={onChange} connected />);

  fireEvent.click(screen.getByRole("button", { name: "surreal" }));

  const next = onChange.mock.calls[0][0];
  expect(next.intensity).toBe("surreal");
  expect(next.sampling.temperature).toBe(PRESETS.surreal.sampling.temperature);
  expect(next.effects.egoDissolution).toBe(true);
});

test("editing a sampling slider detaches to custom", () => {
  const onChange = vi.fn();
  render(<AlteredStateConsole tuning={DEFAULT_TUNING} onChange={onChange} connected />);

  // temperature is the first slider in the panel
  const temperature = screen.getAllByRole("slider")[0];
  fireEvent.change(temperature, { target: { value: "1.7" } });

  const next = onChange.mock.calls[0][0];
  expect(next.intensity).toBe("custom");
  expect(next.sampling.temperature).toBe(1.7);
});
