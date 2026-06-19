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
 * Per-frame motion = how much the shape changed since the previous frame
 * (radians). Low and steady ⇒ they're holding still. This is the "deviation
 * detection": the hold timer only advances while motion stays below threshold,
 * and resets the moment they move.
 */
export function motionMetric(prev: PoseVector, curr: PoseVector): number {
  return angleDistance(prev, curr);
}
