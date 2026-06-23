import { expect, test } from "vitest";
import { buildVideoConstraints } from "./usePoseLandmarker";

test("default (no deviceId) keeps the 1280x720 request only", () => {
  expect(buildVideoConstraints()).toEqual({ width: 1280, height: 720 });
});

test("pins an exact deviceId when provided", () => {
  expect(buildVideoConstraints("cam-iphone")).toEqual({
    width: 1280,
    height: 720,
    deviceId: { exact: "cam-iphone" },
  });
});
