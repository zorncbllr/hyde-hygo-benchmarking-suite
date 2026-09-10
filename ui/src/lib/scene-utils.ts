import type { SurfaceResponse } from "./schemas";

type Bounds = Pick<SurfaceResponse, "lo" | "hi">;

export function normalizePositions(
  raw: Record<string, Array<[number, number]>>,
  surface: Bounds,
): Record<string, Array<[number, number]>> {
  const [xlo, ylo] = surface.lo;
  const [xhi, yhi] = surface.hi;
  const sx = xhi - xlo || 1;
  const sy = yhi - ylo || 1;
  const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
  const out: Record<string, Array<[number, number]>> = {};
  for (const [algo, pts] of Object.entries(raw)) {
    out[algo] = pts.map(([x, y]) => [
      clamp01((x - xlo) / sx),
      clamp01((y - ylo) / sy),
    ]);
  }
  return out;
}

/**
 * Normalized stratum edge positions (0..1, length strata + 1) for the LHS
 * initialization overlay. Edges are uniform for decision-space sampling;
 * for qubit-encoded algorithms the samples live in theta space and are
 * observed through sin^2, so the decision-space edges are warped by
 * sin^2(k/N * pi/2) — steep near 0 and pi/2, flat in the middle.
 */
export function lhsStrataEdges(strata: number, qubit: boolean): number[] {
  const n = Math.max(1, Math.floor(strata));
  const edges: number[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    edges.push(qubit ? Math.sin((t * Math.PI) / 2) ** 2 : t);
  }
  return edges;
}

/**
 * Inverse map for the LHS overlay: which stratum index does a point at
 * normalized position ``t`` belong to (0-based)? Uniform for decision-space
 * sampling; via arcsin(sqrt(t)) for qubit-observed positions. When the
 * variant encodes parameters on a discrete grid (``levels`` = 2^Nb), the
 * point is first snapped to the level the algorithm's encode/decode
 * rounds it onto — a decoded point at a stratum edge belongs to the
 * stratum its grid level falls in, not the raw position's.
 */
export function lhsStratumIndex(
  t: number,
  strata: number,
  qubit: boolean,
  levels = 0,
): number {
  const n = Math.max(1, Math.floor(strata));
  const c = Math.min(1, Math.max(0, t));
  if (levels >= 2 && !qubit) {
    const level = Math.round(c * (levels - 1));
    return Math.min(n - 1, Math.floor((level * n) / levels));
  }
  const u = qubit ? (Math.asin(Math.sqrt(c)) * 2) / Math.PI : c;
  return Math.min(n - 1, Math.floor(u * n));
}

/**
 * Greedy nearest matching in normalized space (used by the movement
 * arrows and the population transition animation): for each current
 * point, the index of its nearest unused predecessor within ``maxDist``,
 * or -1 when nothing is close enough (e.g. recovery jumps).
 */
export function matchNearest(
  current: Array<[number, number]>,
  previous: Array<[number, number]>,
  maxDist = 0.2,
): number[] {
  const used = new Set<number>();
  const out: number[] = new Array(current.length).fill(-1);
  for (let i = 0; i < current.length; i++) {
    const [cx, cy] = current[i];
    let best = -1;
    let bestD = maxDist;
    for (let j = 0; j < previous.length; j++) {
      if (used.has(j)) continue;
      const d = Math.hypot(cx - previous[j][0], cy - previous[j][1]);
      if (d < bestD) {
        bestD = d;
        best = j;
      }
    }
    if (best >= 0) {
      used.add(best);
      out[i] = best;
    }
  }
  return out;
}

/** Deceleration curve for the population transition animation. */
export function easeOutCubic(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return 1 - (1 - c) ** 3;
}
