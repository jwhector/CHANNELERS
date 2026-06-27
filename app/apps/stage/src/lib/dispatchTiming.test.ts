import { expect, test } from "vitest";
import { remainingSec, fmtClock, noShowDeadline } from "./dispatchTiming";

test("remainingSec clamps at 0 and rounds up", () => {
  expect(remainingSec(10_000, 0)).toBe(10);
  expect(remainingSec(10_001, 0)).toBe(11);
  expect(remainingSec(0, 10_000)).toBe(0);
});

test("fmtClock: sub-minute as Ns, minute+ as m:ss", () => {
  expect(fmtClock(45)).toBe("45s");
  expect(fmtClock(60)).toBe("1:00");
  expect(fmtClock(90)).toBe("1:30");
});

test("noShowDeadline adds noShowMs to the since timestamp", () => {
  expect(noShowDeadline("1970-01-01T00:00:10.000Z", 5_000)).toBe(15_000);
});
