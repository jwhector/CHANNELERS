import { expect, test, vi } from "vitest";
import { drawAura } from "./poseUI";
import type { Landmark } from "../lib/pose/landmarks";

function fakeCanvas() {
  const grad = { addColorStop: vi.fn() };
  const ctx = {
    fillStyle: "", strokeStyle: "", lineWidth: 0, shadowBlur: 0, shadowColor: "", globalCompositeOperation: "",
    fillRect: vi.fn(), clearRect: vi.fn(),
    beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(),
    arc: vi.fn(), fill: vi.fn(), save: vi.fn(), restore: vi.fn(),
    createRadialGradient: vi.fn(() => grad),
  };
  const canvas = { width: 200, height: 120, getContext: () => ctx } as unknown as HTMLCanvasElement;
  return { canvas, ctx };
}

const landmarks = (v: number): Landmark[] =>
  Array.from({ length: 33 }, (_, i) => ({ x: 0.1 + (i % 7) * 0.1, y: 0.1 + Math.floor(i / 7) * 0.08, z: 0, visibility: v }));

test("paints an opaque full-canvas background (hides the webcam)", () => {
  const { canvas, ctx } = fakeCanvas();
  drawAura(canvas, landmarks(1));
  expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 200, 120);
});

test("draws a glowing colorblob per visible landmark", () => {
  const { canvas, ctx } = fakeCanvas();
  drawAura(canvas, landmarks(1));
  expect(ctx.createRadialGradient).toHaveBeenCalled();
  expect(ctx.arc).toHaveBeenCalled();
});

test("with no pose, still hides the webcam but draws no blobs", () => {
  const { canvas, ctx } = fakeCanvas();
  drawAura(canvas, null);
  expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 200, 120);
  expect(ctx.createRadialGradient).not.toHaveBeenCalled();
});

test("no-ops without a canvas", () => {
  expect(() => drawAura(null, landmarks(1))).not.toThrow();
});
