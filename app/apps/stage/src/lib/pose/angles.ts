import { JOINTS, type Landmark } from "./landmarks";

/**
 * A pose reduced to what matters for matching: one angle per joint (radians) plus
 * a per-joint weight (how much we trust that angle, from landmark visibility).
 * This is the whole representation — translation/scale/identity-invariant by
 * construction, so "same shape" survives the visitor standing somewhere else or
 * being a different size than whoever recorded it.
 */
export type PoseVector = { angles: number[]; weights: number[] };

/** Interior angle at `b` between b→a and b→c, in 2D. Range [0, π]. */
function jointAngle(a: Landmark, b: Landmark, c: Landmark): number {
  const ux = a.x - b.x;
  const uy = a.y - b.y;
  const vx = c.x - b.x;
  const vy = c.y - b.y;
  const dot = ux * vx + uy * vy;
  const lu = Math.hypot(ux, uy);
  const lv = Math.hypot(vx, vy);
  if (lu === 0 || lv === 0) return 0;
  // Clamp guards against fp drift pushing acos out of [-1, 1].
  return Math.acos(Math.max(-1, Math.min(1, dot / (lu * lv))));
}

const vis = (l: Landmark) => l.visibility ?? 1;

/** Reduce a frame of landmarks to its angle vector. */
export function landmarksToAngles(lms: Landmark[]): PoseVector {
  const angles: number[] = [];
  const weights: number[] = [];
  for (const j of JOINTS) {
    const a = lms[j.a];
    const b = lms[j.b];
    const c = lms[j.c];
    if (!a || !b || !c) {
      angles.push(0);
      weights.push(0);
      continue;
    }
    angles.push(jointAngle(a, b, c));
    // Trust this angle only as much as its least-visible joint.
    weights.push(Math.min(vis(a), vis(b), vis(c)));
  }
  return { angles, weights };
}

/**
 * Weighted mean absolute angular difference between two poses, in radians.
 * The core primitive: small = poses agree. Joints where *either* pose is
 * low-confidence contribute little. Used both for matching (vs. a saved
 * template) and for stillness (vs. the previous frame).
 */
export function angleDistance(p: PoseVector, q: PoseVector): number {
  let wsum = 0;
  let dsum = 0;
  for (let i = 0; i < p.angles.length; i++) {
    const w = p.weights[i] * q.weights[i];
    wsum += w;
    dsum += w * Math.abs(p.angles[i] - q.angles[i]);
  }
  return wsum > 0 ? dsum / wsum : Math.PI;
}

/** Similarity in [0,1]: 1 = identical shape, 0 = maximally different. */
export function poseSimilarity(p: PoseVector, q: PoseVector): number {
  return 1 - angleDistance(p, q) / Math.PI;
}

/**
 * How much of the body we can confidently see, in [0,1]: the mean per-joint
 * weight. Legs leaving the frame drop the leg joints to ~0, so a full-body
 * stance scores high and an upper-body-only crop sits around 0.5. This is what
 * tells us whether the visitor is framed head-to-toe well enough to enroll.
 */
export function bodyCoverage(vec: PoseVector): number {
  if (vec.weights.length === 0) return 0;
  return vec.weights.reduce((s, w) => s + w, 0) / vec.weights.length;
}

// Two thresholds, not one, so the "step into frame" warning can't strobe when
// coverage hovers at the boundary: you must climb past ENTER to count as framed
// and fall below EXIT to count as out. ENTER sits above the ~0.5 an upper-body
// crop scores, so partial framing is correctly rejected.
export const FRAME_ENTER = 0.65;
export const FRAME_EXIT = 0.55;

/**
 * Hysteretic "is the whole body in frame" test. Pure so it's testable; the
 * caller threads the previous result back in as `wasFramed`.
 */
export function isBodyFramed(coverage: number, wasFramed: boolean): boolean {
  return wasFramed ? coverage >= FRAME_EXIT : coverage >= FRAME_ENTER;
}

/**
 * Per-frame motion = how much the shape changed since the previous frame
 * (radians). Low and steady ⇒ they're holding still. This is the "deviation
 * detection": the hold timer only advances while motion stays below threshold,
 * and resets the moment they move.
 */
export function motionMetric(prev: PoseVector, curr: PoseVector): number {
  return angleDistance(prev, curr);
}
