import type { SurfaceResponse } from "./schemas";

export function normalizePositions(
  raw: Record<string, Array<[number, number]>>,
  surface: SurfaceResponse,
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
