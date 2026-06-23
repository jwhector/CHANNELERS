import { expect, test } from "vitest";
import { resolveDeviceId } from "./devices";

const dev = (deviceId: string, label: string): MediaDeviceInfo =>
  ({ deviceId, label, kind: "audiooutput", groupId: "", toJSON: () => ({}) } as MediaDeviceInfo);

test("URL label substring match wins (case-insensitive)", () => {
  const devices = [dev("aaa", "Built-in"), dev("bbb", "Scarlett IEM-2")];
  expect(resolveDeviceId("iem-2", "aaa", devices)).toBe("bbb");
});

test("falls back to the stored id when it still exists", () => {
  const devices = [dev("aaa", "Built-in"), dev("bbb", "Scarlett")];
  expect(resolveDeviceId(null, "bbb", devices)).toBe("bbb");
});

test("trusts a stored id when labels are not loaded yet (empty list)", () => {
  expect(resolveDeviceId(null, "bbb", [])).toBe("bbb");
});

test("returns '' (system default) when nothing matches", () => {
  const devices = [dev("aaa", "Built-in")];
  expect(resolveDeviceId("nope", "gone", devices)).toBe("");
});
