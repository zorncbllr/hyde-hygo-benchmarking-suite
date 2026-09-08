import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildHeightField,
  colormapRedBlack,
} from "@/components/scene/heightField";
import { ALGO_COLORS, type AlgoKey, type SurfaceResponse } from "@/lib/schemas";

interface SimMap2DProps {
  surface: SurfaceResponse;
  algoKey: AlgoKey;
  /** current population (decision space) */
  positions: Array<[number, number]> | null;
  /** population one generation earlier, for movement arrows */
  prevPositions: Array<[number, number]> | null;
  /** best-so-far trail (decision space) */
  trail: Array<[number, number]>;
  bestX: [number, number] | null;
  className?: string;
}

const CONTOUR_BANDS = 9;
const POINT_R = 5;
const BEST_R = 7.5;
/** max normalized distance for matching an individual to its predecessor */
const ARROW_MAX_DIST = 0.2;

type Pt = [number, number];

/**
 * Top-down contour map of the benchmark landscape with the algorithm's
 * dynamics overlaid: population points, movement arrows from the previous
 * generation (what the code just did), the best-so-far trail and the current
 * best position. This is the comprehension-first view; the 3D surface stays
 * available as a secondary perspective.
 */
export default function SimMap2D({
  surface,
  algoKey,
  positions,
  prevPositions,
  trail,
  bestX,
  className,
}: SimMap2DProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const color = ALGO_COLORS[algoKey];

  const field = useMemo(() => buildHeightField(surface.zs, true), [surface]);

  // Precompute the heatmap colors and contour segments once per surface.
  const heat = useMemo(() => {
    if (!field) return null;
    const { rows, cols, at } = field;
    const colors: string[] = new Array(rows * cols);
    const bands: Uint8Array = new Uint8Array(rows * cols);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const t = at(r, c);
        colors[r * cols + c] = colormapRedBlack(t).getStyle();
        bands[r * cols + c] = Math.min(
          CONTOUR_BANDS - 1,
          Math.floor(t * CONTOUR_BANDS),
        );
      }
    }
    return { rows, cols, colors, bands };
  }, [field]);

  // Track container size.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0].contentRect;
      setSize({ w: rect.width, h: rect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Redraw on any state change.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.w < 4 || size.h < 4) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(size.w * dpr);
    canvas.height = Math.round(size.h * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = size.w;
    const H = size.h;

    // background
    ctx.fillStyle = "#09090b";
    ctx.fillRect(0, 0, W, H);

    // heatmap
    if (heat) {
      const cw = W / heat.cols;
      const ch = H / heat.rows;
      for (let r = 0; r < heat.rows; r++) {
        for (let c = 0; c < heat.cols; c++) {
          ctx.fillStyle = heat.colors[r * heat.cols + c];
          ctx.fillRect(c * cw, r * ch, cw + 0.5, ch + 0.5);
        }
      }
      // contour-ish band edges: a dark pass for light terrain and a light
      // pass for dark terrain, so the relief reads across the whole ramp
      const contour = (style: string) => {
        ctx.strokeStyle = style;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let r = 0; r < heat.rows; r++) {
          for (let c = 0; c < heat.cols; c++) {
            const b = heat.bands[r * heat.cols + c];
            if (c + 1 < heat.cols && heat.bands[r * heat.cols + c + 1] !== b) {
              ctx.moveTo((c + 1) * cw, r * ch);
              ctx.lineTo((c + 1) * cw, (r + 1) * ch);
            }
            if (
              r + 1 < heat.rows &&
              heat.bands[(r + 1) * heat.cols + c] !== b
            ) {
              ctx.moveTo(c * cw, (r + 1) * ch);
              ctx.lineTo((c + 1) * cw, (r + 1) * ch);
            }
          }
        }
        ctx.stroke();
      };
      contour("rgba(0,0,0,0.45)");
      contour("rgba(255,255,255,0.28)");
    }

    const px = (p: Pt): [number, number] => {
      const [xlo, ylo] = surface.lo;
      const [xhi, yhi] = surface.hi;
      const sx = xhi - xlo || 1;
      const sy = yhi - ylo || 1;
      const xn = Math.min(1, Math.max(0, (p[0] - xlo) / sx));
      const yn = Math.min(1, Math.max(0, (p[1] - ylo) / sy));
      return [xn * W, H - yn * H];
    };

    const norm = (p: Pt): Pt => {
      const [xlo, ylo] = surface.lo;
      const [xhi, yhi] = surface.hi;
      const sx = xhi - xlo || 1;
      const sy = yhi - ylo || 1;
      return [
        Math.min(1, Math.max(0, (p[0] - xlo) / sx)),
        Math.min(1, Math.max(0, (p[1] - ylo) / sy)),
      ];
    };

    // movement arrows: match current points to their nearest predecessor
    if (prevPositions && positions && prevPositions.length > 0) {
      const prevN = prevPositions.map(norm);
      const used = new Set<number>();
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.7;
      ctx.lineWidth = 2.5;
      for (const raw of positions) {
        const cur = norm(raw);
        let bestJ = -1;
        let bestD = ARROW_MAX_DIST;
        for (let j = 0; j < prevN.length; j++) {
          if (used.has(j)) continue;
          const dx = cur[0] - prevN[j][0];
          const dy = cur[1] - prevN[j][1];
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < bestD) {
            bestD = d;
            bestJ = j;
          }
        }
        if (bestJ === -1) continue;
        used.add(bestJ);
        const [ax, ay] = [prevN[bestJ][0] * W, H - prevN[bestJ][1] * H];
        const [bx, by] = [cur[0] * W, H - cur[1] * H];
        const dx = bx - ax;
        const dy = by - ay;
        const len = Math.hypot(dx, dy);
        if (len < 6) continue; // effectively stationary
        const ux = dx / len;
        const uy = dy / len;
        const tipX = bx - ux * (POINT_R + 2);
        const tipY = by - uy * (POINT_R + 2);
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(tipX, tipY);
        ctx.stroke();
        // arrowhead
        const hx = -uy;
        const hy = ux;
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(tipX + hx * 3.5, tipY + hy * 3.5);
        ctx.lineTo(tipX - hx * 3.5, tipY - hy * 3.5);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // best-so-far trail: neutral white (distinct from the algo-colored
    // movement arrows); each segment is one hop of the best position
    if (trail.length > 0) {
      ctx.strokeStyle = "#f4f4f5";
      ctx.lineWidth = 2.5;
      for (let i = 1; i < trail.length; i++) {
        const [x0, y0] = px(trail[i - 1]);
        const [x1, y1] = px(trail[i]);
        ctx.globalAlpha = 0.18 + 0.72 * (i / trail.length);
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
      }
      // small node at each hop so the path reads as discrete best updates
      ctx.fillStyle = "#f4f4f5";
      for (let i = 0; i < trail.length; i++) {
        const [x0, y0] = px(trail[i]);
        ctx.globalAlpha = 0.25 + 0.6 * (i / trail.length);
        ctx.beginPath();
        ctx.arc(x0, y0, 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // population points
    if (positions && positions.length > 0) {
      for (const raw of positions) {
        const [xn, yn] = norm(raw);
        const x = xn * W;
        const y = H - yn * H;
        ctx.beginPath();
        ctx.arc(x, y, POINT_R, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = "rgba(255,255,255,0.85)";
        ctx.stroke();
      }
    }

    // current best position marker
    if (bestX) {
      const [bx, by] = px(bestX);
      ctx.beginPath();
      ctx.arc(bx, by, BEST_R, 0, Math.PI * 2);
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.stroke();
      // crosshair ticks
      ctx.beginPath();
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        ctx.moveTo(bx + dx * (BEST_R + 2), by + dy * (BEST_R + 2));
        ctx.lineTo(bx + dx * (BEST_R + 7), by + dy * (BEST_R + 7));
      }
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.font = "600 10px ui-monospace, monospace";
      ctx.fillText("best", bx + BEST_R + 9, by + 3);
    }

    // bounds caption
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.font = "10px ui-monospace, monospace";
    ctx.fillText(
      `x ${surface.lo[0].toFixed(1)}..${surface.hi[0].toFixed(1)}  y ${surface.lo[1].toFixed(1)}..${surface.hi[1].toFixed(1)}`,
      8,
      H - 8,
    );
  }, [size, heat, positions, prevPositions, trail, bestX, surface, color]);

  return (
    <div ref={wrapRef} className={className ?? "relative h-full w-full"}>
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  );
}
