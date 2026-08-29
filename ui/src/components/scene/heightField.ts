import * as THREE from "three";

export interface HeightField {
  rows: number;
  cols: number;
  /** Normalized height (0..1) at grid cell (row, col). */
  at: (row: number, col: number) => number;
  /** Normalized height at normalized coordinates xn, yn in [0,1]. */
  sample: (xn: number, yn: number) => number;
}

/**
 * Transforms raw function values into normalized render heights, optionally
 * log-scaled. Shared by the surface mesh (displacement + color) and the
 * search-point overlay (exact height placement).
 */
export function buildHeightField(
  zs: number[][],
  logScale: boolean,
): HeightField | null {
  const rows = zs.length;
  const cols = rows > 0 ? zs[0].length : 0;
  if (rows < 2 || cols < 2) return null;

  const flat = zs.flat();
  const transformed = logScale
    ? flat.map((v) => Math.log10(Math.abs(v) + 1e-9))
    : [...flat];
  let zMin = Infinity;
  let zMax = -Infinity;
  for (const v of transformed) {
    if (!Number.isFinite(v)) continue;
    zMin = Math.min(zMin, v);
    zMax = Math.max(zMax, v);
  }
  const range = zMax - zMin || 1;

  const at = (row: number, col: number) =>
    (transformed[row * cols + col] - zMin) / range;

  const sample = (xn: number, yn: number) => {
    const col = Math.min(cols - 1, Math.max(0, Math.round(xn * (cols - 1))));
    const row = Math.min(rows - 1, Math.max(0, Math.round(yn * (rows - 1))));
    return at(row, col);
  };

  return { rows, cols, at, sample };
}

/** Applies a HeightField to a PlaneGeometry (Z displacement + vertex colors). */
export function applyFieldToGeometry(
  geo: THREE.PlaneGeometry,
  field: HeightField,
): void {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  for (let r = 0; r < field.rows; r++) {
    for (let c = 0; c < field.cols; c++) {
      const idx = r * field.cols + c;
      const h = field.at(r, c);
      pos.setZ(idx, h);
      const color = colormap(h);
      colors[idx * 3] = color.r;
      colors[idx * 3 + 1] = color.g;
      colors[idx * 3 + 2] = color.b;
    }
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
}

/** Minimal viridis-like colormap: value in [0,1] -> THREE.Color. */
export function colormap(t: number): THREE.Color {
  const stops = [
    [0.267, 0.005, 0.329],
    [0.283, 0.141, 0.458],
    [0.254, 0.265, 0.53],
    [0.207, 0.372, 0.553],
    [0.164, 0.471, 0.558],
    [0.128, 0.567, 0.551],
    [0.135, 0.659, 0.518],
    [0.267, 0.749, 0.441],
    [0.478, 0.821, 0.318],
    [0.741, 0.873, 0.15],
    [0.993, 0.906, 0.144],
  ] as const;
  const clamped = Math.min(1, Math.max(0, t));
  const scaled = clamped * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(scaled));
  const f = scaled - i;
  const a = stops[i];
  const b = stops[i + 1];
  return new THREE.Color(
    a[0] + f * (b[0] - a[0]),
    a[1] + f * (b[1] - a[1]),
    a[2] + f * (b[2] - a[2]),
  );
}
