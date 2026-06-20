/**
 * BlazePose / MediaPipe 33-landmark model: indices, the joints we measure, and the
 * skeleton connections we draw. See ARCHITECTURE.md §6 (the "human QR code").
 *
 * A landmark is normalized to the video frame: x,y ∈ [0,1] (origin top-left),
 * z is a *relative* depth (noisy — we deliberately ignore it), and visibility is
 * the model's confidence that the joint is actually seen.
 */
export type Landmark = { x: number; y: number; z: number; visibility?: number };

/** The 33 landmark indices we care about (subset of the full BlazePose set). */
export const LM = {
  nose: 0,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
} as const;

/**
 * The joints that define a "shape." Each is an angle at vertex `b` between the
 * limbs b→a and b→c. Angles are translation- and scale-invariant for free, which
 * is exactly what we want: where you stand and how big you are shouldn't matter,
 * only the shape your limbs make. We measure these in 2D (x,y) and ignore z.
 */
export const JOINTS: { name: string; a: number; b: number; c: number }[] = [
  { name: "L elbow", a: LM.leftShoulder, b: LM.leftElbow, c: LM.leftWrist },
  { name: "R elbow", a: LM.rightShoulder, b: LM.rightElbow, c: LM.rightWrist },
  { name: "L shoulder", a: LM.leftElbow, b: LM.leftShoulder, c: LM.leftHip },
  { name: "R shoulder", a: LM.rightElbow, b: LM.rightShoulder, c: LM.rightHip },
  { name: "L hip", a: LM.leftShoulder, b: LM.leftHip, c: LM.leftKnee },
  { name: "R hip", a: LM.rightShoulder, b: LM.rightHip, c: LM.rightKnee },
  { name: "L knee", a: LM.leftHip, b: LM.leftKnee, c: LM.leftAnkle },
  { name: "R knee", a: LM.rightHip, b: LM.rightKnee, c: LM.rightAnkle },
];

/** Bones to draw for the skeleton overlay (pairs of landmark indices). */
export const CONNECTIONS: [number, number][] = [
  [LM.leftShoulder, LM.rightShoulder],
  [LM.leftShoulder, LM.leftElbow],
  [LM.leftElbow, LM.leftWrist],
  [LM.rightShoulder, LM.rightElbow],
  [LM.rightElbow, LM.rightWrist],
  [LM.leftShoulder, LM.leftHip],
  [LM.rightShoulder, LM.rightHip],
  [LM.leftHip, LM.rightHip],
  [LM.leftHip, LM.leftKnee],
  [LM.leftKnee, LM.leftAnkle],
  [LM.rightHip, LM.rightKnee],
  [LM.rightKnee, LM.rightAnkle],
];
