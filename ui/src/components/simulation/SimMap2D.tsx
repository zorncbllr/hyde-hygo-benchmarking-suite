import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildHeightField,
  colormapRedBlack,
} from "@/components/scene/heightField";
import {
  easeOutCubic,
  lhsStrataEdges,
  lhsStratumIndex,
  matchNearest,
} from "@/lib/scene-utils";
import {
  ALGO_COLORS,
  type AlgoKey,
  type SimOps,
  type SurfaceResponse,
} from "@/lib/schemas";

interface SimMap2DProps {
  surface: SurfaceResponse;
  /** the decision-space bounds the trace actually ran on; all overlay
   * geometry (points, strata grid, arrows) is normalized against these,
   * never against the surface's bounds */
  traceBounds: { lo: [number, number]; hi: [number, number] };
  algoKey: AlgoKey;
  /** current population (decision space) */
  positions: Array<[number, number]> | null;
  /** population one generation earlier, for movement arrows */
  prevPositions: Array<[number, number]> | null;
  /** best-so-far trail (decision space) */
  trail: Array<[number, number]>;
  bestX: [number, number] | null;
  /** operator-level geometry of the current step (phase-aware overlay) */
  ops: SimOps | null;
  /** playback is on the final event: emphasize the best returned result */
  highlightResult?: boolean;
  className?: string;
}

const CONTOUR_BANDS = 9;
const POINT_R = 5;
const BEST_R = 7.5;
/** max normalized distance for matching an individual to its predecessor */
const ARROW_MAX_DIST = 0.2;
/** duration of the population transition animation (generation -> generation) */
const ANIM_MS = 380;

type Pt = [number, number];

const MOVE_COLORS: Record<string, string> = {
  reflect: "#4ade80",
  expand: "#22d3ee",
  contract: "#f59e0b",
  shrink: "#fb7185",
  random: "#e879f9",
  r2: "#a78bfa",
};

const GA_COLORS: Record<string, string> = {
  crossover: "#38bdf8",
  mutation: "#f97316",
  replication: "#94a3b8",
  elite: "#4ade80",
};

/**
 * Top-down contour map of the benchmark landscape with the algorithm's
 * dynamics overlaid: population points, movement arrows from the previous
 * generation (what the code just did), the best-so-far trail and the current
 * best position. This is the comprehension-first view; the 3D surface stays
 * available as a secondary perspective.
 */
export default function SimMap2D({
  surface,
  traceBounds,
  algoKey,
  positions,
  prevPositions,
  trail,
  bestX,
  ops,
  highlightResult = false,
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

  // Population transition plan: normalized previous/current points plus
  // the greedy match between them. Recomputed only when the displayed
  // generation changes, so playback within a generation does not restart
  // the animation.
  const transition = useMemo(() => {
    if (
      !positions ||
      !prevPositions ||
      positions.length === 0 ||
      prevPositions.length === 0
    )
      return null;
    const [xlo, ylo] = traceBounds.lo;
    const [xhi, yhi] = traceBounds.hi;
    const sx = xhi - xlo || 1;
    const sy = yhi - ylo || 1;
    const toN = (p: [number, number]): [number, number] => [
      Math.min(1, Math.max(0, (p[0] - xlo) / sx)),
      Math.min(1, Math.max(0, (p[1] - ylo) / sy)),
    ];
    const cur = positions.map(toN);
    const prev = prevPositions.map(toN);
    const match = matchNearest(cur, prev, ARROW_MAX_DIST);
    return { cur, prev, match, any: match.some((m) => m >= 0) };
  }, [positions, prevPositions, traceBounds]);

  // Animate the transition: dots tween from the previous generation to
  // the new one (along the movement arrows) so DE movement is visible.
  const [animT, setAnimT] = useState(1);
  useEffect(() => {
    if (!transition || !transition.any) {
      setAnimT(1);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = () => {
      const t = Math.min(1, (performance.now() - start) / ANIM_MS);
      setAnimT(t);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [transition]);

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
      const [xlo, ylo] = traceBounds.lo;
      const [xhi, yhi] = traceBounds.hi;
      const sx = xhi - xlo || 1;
      const sy = yhi - ylo || 1;
      const xn = Math.min(1, Math.max(0, (p[0] - xlo) / sx));
      const yn = Math.min(1, Math.max(0, (p[1] - ylo) / sy));
      return [xn * W, H - yn * H];
    };

    const norm = (p: Pt): Pt => {
      const [xlo, ylo] = traceBounds.lo;
      const [xhi, yhi] = traceBounds.hi;
      const sx = xhi - xlo || 1;
      const sy = yhi - ylo || 1;
      return [
        Math.min(1, Math.max(0, (p[0] - xlo) / sx)),
        Math.min(1, Math.max(0, (p[1] - ylo) / sy)),
      ];
    };

    // -- operator overlays (drawn under the population, above terrain) -----

    const drawArrow = (
      from: Pt,
      to: Pt,
      style: string,
      alpha = 0.9,
      dash: number[] = [],
      width = 2,
    ) => {
      const [ax, ay] = px(from);
      const [bx, by] = px(to);
      const dx = bx - ax;
      const dy = by - ay;
      const len = Math.hypot(dx, dy);
      if (len < 2) return;
      const ux = dx / len;
      const uy = dy / len;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = style;
      ctx.fillStyle = style;
      ctx.lineWidth = width;
      ctx.setLineDash(dash);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
      ctx.setLineDash([]);
      // arrowhead
      const hx = -uy;
      const hy = ux;
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx - ux * 5 + hx * 3.5, by - uy * 5 + hy * 3.5);
      ctx.lineTo(bx - ux * 5 - hx * 3.5, by - uy * 5 - hy * 3.5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    };

    const drawMoveArrows = (
      moves: Array<{ from: Pt; to: Pt }>,
      color: string,
      dash: number[] = [],
    ) => {
      for (const m of moves) drawArrow(m.from, m.to, color, 0.85, dash, 2);
    };

    if (ops) {
      const [xlo, ylo] = surface.lo;
      const [xhi, yhi] = surface.hi;
      const sxu = xhi - xlo || 1;
      const syu = yhi - ylo || 1;

      if (ops.type === "lhs") {
        // LHS initialization: stratum boundaries, the permutation-matrix
        // of occupied stratum cells (exactly one sample per row/column)
        // and, when reordering ran, the farthest-point visit order.
        const n = ops.strata;
        const edges = lhsStrataEdges(n, !!ops.qubit);
        ctx.save();
        ctx.globalAlpha = 0.4;
        ctx.strokeStyle = "rgba(255,255,255,0.9)";
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 4]);
        ctx.beginPath();
        for (let i = 1; i < n; i++) {
          const t = edges[i];
          ctx.moveTo(t * W, 0);
          ctx.lineTo(t * W, H);
          ctx.moveTo(0, t * H);
          ctx.lineTo(W, t * H);
        }
        ctx.stroke();
        ctx.restore();

        // occupied stratum cells: one per row and per column (the Latin
        // property) — additive fills make coverage density visible
        if (positions && positions.length > 0) {
          ctx.save();
          ctx.fillStyle = "rgba(255,255,255,0.9)";
          ctx.globalAlpha = 0.08;
          for (const raw of positions) {
            const [xn, yn] = norm(raw);
            const cx = lhsStratumIndex(xn, n, !!ops.qubit, ops.levels ?? 0);
            const cy = lhsStratumIndex(yn, n, !!ops.qubit, ops.levels ?? 0);
            const x0 = edges[cx] * W;
            const x1 = edges[cx + 1] * W;
            // y is normalized bottom-up; cell spans edges in the same way
            const yTop = H - edges[cy + 1] * H;
            const yBot = H - edges[cy] * H;
            ctx.fillRect(x0, yTop, x1 - x0, yBot - yTop);
          }
          ctx.restore();
        }

        // farthest-point greedy procedure, step by step: the full raw
        // pool, the visit sequence built so far (dashed path + numbered
        // stops), each unselected sample shaded by its min-distance to
        // the selected set (the greedy criterion), and a ring on the
        // point that will be picked next.
        if (ops.reorder && positions && positions.length > 0) {
          const inProgress =
            ops.stage === "reorder" &&
            ops.order != null &&
            ops.dists != null &&
            ops.order.length > 0;
          if (inProgress) {
            const order = ops.order!;
            const dists = ops.dists!;
            const selectedSet = new Set(order);
            const maxD = Math.max(1e-12, ...dists);
            // unselected samples: brightness = current min-distance
            ctx.save();
            positions.forEach((raw, i) => {
              if (selectedSet.has(i)) return;
              const [x, y] = px(raw);
              const t = Math.min(1, Math.max(0, dists[i] / maxD));
              ctx.globalAlpha = 0.25 + 0.55 * t;
              ctx.fillStyle = "#ffffff";
              ctx.beginPath();
              ctx.arc(x, y, 3.5, 0, Math.PI * 2);
              ctx.fill();
            });
            ctx.restore();
            // dashed tour through the selected sequence
            if (order.length > 1) {
              ctx.save();
              ctx.strokeStyle = "rgba(255,255,255,0.55)";
              ctx.lineWidth = 1.5;
              ctx.setLineDash([2, 3]);
              ctx.beginPath();
              order.forEach((idx, k) => {
                const [x, y] = px(positions[idx]);
                if (k === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
              });
              ctx.stroke();
              ctx.restore();
            }
            // numbered selected points
            ctx.save();
            ctx.fillStyle = "rgba(255,255,255,0.9)";
            order.forEach((idx, k) => {
              const [x, y] = px(positions[idx]);
              ctx.beginPath();
              ctx.arc(x, y, POINT_R, 0, Math.PI * 2);
              ctx.fill();
              ctx.lineWidth = 1.5;
              ctx.strokeStyle = "rgba(0,0,0,0.7)";
              ctx.stroke();
              ctx.fillStyle = "rgba(255,255,255,0.95)";
              ctx.font = "600 9px ui-monospace, monospace";
              ctx.fillText(String(k + 1), x + POINT_R + 2, y - POINT_R - 2);
            });
            ctx.restore();
            // the point about to be selected: max min-distance among the rest
            let nextIdx = -1;
            let bestD = -1;
            dists.forEach((d, i) => {
              if (!selectedSet.has(i) && d > bestD) {
                bestD = d;
                nextIdx = i;
              }
            });
            if (nextIdx >= 0) {
              const [x, y] = px(positions[nextIdx]);
              ctx.save();
              ctx.strokeStyle = "rgba(255,255,255,0.95)";
              ctx.lineWidth = 2;
              ctx.beginPath();
              ctx.arc(x, y, POINT_R + 3, 0, Math.PI * 2);
              ctx.stroke();
              ctx.fillStyle = "rgba(255,255,255,0.95)";
              ctx.font = "600 9px ui-monospace, monospace";
              ctx.fillText("next", x + POINT_R + 6, y + 3);
              ctx.restore();
            }
          } else if (ops.stage === "reorder" && positions.length > 1) {
            ctx.save();
            ctx.strokeStyle = "rgba(255,255,255,0.55)";
            ctx.lineWidth = 1.5;
            ctx.setLineDash([2, 3]);
            ctx.beginPath();
            positions.forEach((raw, i) => {
              const [x, y] = px(raw);
              if (i === 0) ctx.moveTo(x, y);
              else ctx.lineTo(x, y);
            });
            ctx.stroke();
            ctx.restore();
          }
          if (!inProgress && ops.stage !== "sample") {
            ctx.save();
            ctx.fillStyle = "rgba(255,255,255,0.95)";
            ctx.font = "600 9px ui-monospace, monospace";
            positions.forEach((raw, i) => {
              const [x, y] = px(raw);
              ctx.fillText(String(i + 1), x + POINT_R + 2, y - POINT_R - 2);
            });
            ctx.restore();
          }
        }
      } else if (ops.type === "mutation") {
        for (const s of ops.samples) {
          // actual mutant step: x + F*(best-x) + F*(r1-r2), clipped
          const mx =
            s.x[0] + s.f * (s.best[0] - s.x[0]) + s.f * (s.r1[0] - s.r2[0]);
          const my =
            s.x[1] + s.f * (s.best[1] - s.x[1]) + s.f * (s.r1[1] - s.r2[1]);
          const mutant: Pt = [
            Math.min(xhi, Math.max(xlo, mx)),
            Math.min(yhi, Math.max(ylo, my)),
          ];
          // current-to-best pull (dashed) and r1-r2 difference (dotted)
          drawArrow(s.x, s.best, color, 0.45, [4, 4], 1.5);
          const [r1x, r1y] = px(s.r1);
          const [r2x, r2y] = px(s.r2);
          ctx.save();
          ctx.globalAlpha = 0.35;
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 1.5;
          ctx.setLineDash([2, 3]);
          ctx.beginPath();
          ctx.moveTo(r1x, r1y);
          ctx.lineTo(r2x, r2y);
          ctx.stroke();
          ctx.restore();
          // the resulting mutation step
          drawArrow(s.x, mutant, color, 0.9, [], 2.5);
          // crossover mixed parent genes back in: mutant -> child
          const [mxx, mxy] = px(mutant);
          const [cxd, cyd] = px(s.child);
          ctx.save();
          ctx.globalAlpha = 0.55;
          ctx.strokeStyle = "#22d3ee";
          ctx.lineWidth = 1.5;
          ctx.setLineDash([2, 3]);
          ctx.beginPath();
          ctx.moveTo(mxx, mxy);
          ctx.lineTo(cxd, cyd);
          ctx.stroke();
          ctx.restore();
          // selection outcome: filled green = child replaced the parent,
          // hollow rose = rejected (parent survived)
          ctx.save();
          if (s.accepted) {
            ctx.fillStyle = "#4ade80";
            ctx.beginPath();
            ctx.arc(cxd, cyd, 4, 0, Math.PI * 2);
            ctx.fill();
          } else {
            ctx.strokeStyle = "#fb7185";
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(cxd, cyd, 4, 0, Math.PI * 2);
            ctx.stroke();
          }
          ctx.restore();
        }
      } else if (ops.type === "bitflip" || ops.type === "gauss") {
        drawMoveArrows(ops.moves, "#fb7185");
      } else if (ops.type === "tunnel") {
        // reflection pivot: the center of the bounds (theta = pi/4)
        const cxp = (xlo + xhi) / 2;
        const cyp = (ylo + yhi) / 2;
        const [ccx, ccy] = px([cxp, cyp]);
        ctx.save();
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = "#e879f9";
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        ctx.moveTo(ccx - 8, ccy);
        ctx.lineTo(ccx + 8, ccy);
        ctx.moveTo(ccx, ccy - 8);
        ctx.lineTo(ccx, ccy + 8);
        ctx.stroke();
        ctx.restore();
        drawMoveArrows(ops.moves, "#e879f9");
      } else if (ops.type === "cmaes") {
        // sampling distribution: 1-sigma and 2-sigma ellipses from the
        // covariance axes (sigma * B_k * D_k, decision-space vectors)
        const [cxp, cyp] = px(ops.mean);
        const kx = W / sxu;
        const ky = H / syu;
        const a1 = [ops.axes[0][0] * kx, -ops.axes[0][1] * ky];
        const a2 = [ops.axes[1][0] * kx, -ops.axes[1][1] * ky];
        ctx.save();
        ctx.strokeStyle = "#facc15";
        ctx.lineWidth = 1.5;
        for (const scale of [1, 2]) {
          ctx.globalAlpha = scale === 1 ? 0.85 : 0.45;
          ctx.beginPath();
          for (let t = 0; t <= 64; t++) {
            const th = (t / 64) * Math.PI * 2;
            const x =
              cxp + scale * (a1[0] * Math.cos(th) + a2[0] * Math.sin(th));
            const y =
              cyp + scale * (a1[1] * Math.cos(th) + a2[1] * Math.sin(th));
            if (t === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.closePath();
          ctx.stroke();
        }
        // mean marker
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = "#facc15";
        ctx.beginPath();
        ctx.arc(cxp, cyp, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        // mean shift this generation (old mean -> new mean)
        if (ops.mean_old) {
          drawArrow(ops.mean_old, ops.mean, "#facc15", 0.8, [], 2);
        }
        // step size + IPOP restart annotations
        ctx.save();
        ctx.fillStyle = "rgba(250,204,21,0.95)";
        ctx.font = "600 9px ui-monospace, monospace";
        ctx.fillText(`sigma ${ops.sigma.toPrecision(3)}`, cxp + 8, cyp - 10);
        if (ops.restart > 0) {
          ctx.fillText(`restart ${ops.restart}`, cxp + 8, cyp + 16);
        }
        ctx.restore();
      } else if (ops.type === "ga") {
        for (const link of ops.links) {
          const c = GA_COLORS[link.op] ?? "#94a3b8";
          for (const parent of link.parents) {
            const [pxx, pyy] = px(parent);
            const [cxx, cyy] = px(link.child);
            ctx.save();
            ctx.globalAlpha = 0.55;
            ctx.strokeStyle = c;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(pxx, pyy);
            ctx.lineTo(cxx, cyy);
            ctx.stroke();
            ctx.restore();
          }
          // child marker: small diamond
          const [cxx, cyy] = px(link.child);
          ctx.save();
          ctx.globalAlpha = 0.9;
          ctx.fillStyle = c;
          ctx.beginPath();
          ctx.moveTo(cxx, cyy - 4);
          ctx.lineTo(cxx + 4, cyy);
          ctx.lineTo(cxx, cyy + 4);
          ctx.lineTo(cxx - 4, cyy);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
      } else if (ops.type === "dsm") {
        // simplex triangle
        if (ops.simplex.length >= 3) {
          ctx.save();
          ctx.globalAlpha = 0.14;
          ctx.fillStyle = "#4ade80";
          ctx.beginPath();
          ops.simplex.forEach((v, i) => {
            const [vx, vy] = px(v);
            if (i === 0) ctx.moveTo(vx, vy);
            else ctx.lineTo(vx, vy);
          });
          ctx.closePath();
          ctx.fill();
          ctx.globalAlpha = 0.8;
          ctx.strokeStyle = "#4ade80";
          ctx.lineWidth = 1.5;
          ctx.stroke();
          ctx.restore();
        }
        // centroid
        const [ccx, ccy] = px(ops.centroid);
        ctx.save();
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = "#4ade80";
        ctx.beginPath();
        ctx.arc(ccx, ccy, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.font = "600 9px ui-monospace, monospace";
        ctx.fillText("c", ccx + 5, ccy - 4);
        ctx.restore();
        for (const m of ops.moves) {
          drawArrow(m.from, m.to, MOVE_COLORS[m.kind] ?? "#4ade80", 0.9, [], 2);
        }
      }
    }

    // movement arrows: match current points to their nearest predecessor
    if (prevPositions && positions && prevPositions.length > 0) {
      const prevN = prevPositions.map(norm);
      const match = transition
        ? transition.match
        : matchNearest(positions.map(norm), prevN, ARROW_MAX_DIST);
      // movement arrows are neutral white so they read as pure motion,
      // distinct from the algorithm-colored best-so-far trail
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.globalAlpha = 0.75;
      ctx.lineWidth = 2.5;
      positions.forEach((raw, i) => {
        const bestJ = match[i];
        if (bestJ < 0) return;
        const cur = norm(raw);
        const [ax, ay] = [prevN[bestJ][0] * W, H - prevN[bestJ][1] * H];
        const [bx, by] = [cur[0] * W, H - cur[1] * H];
        const dx = bx - ax;
        const dy = by - ay;
        const len = Math.hypot(dx, dy);
        if (len < 6) return;
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
        ctx.fillStyle = "rgba(255,255,255,0.9)";
        ctx.fill();
      });
      ctx.globalAlpha = 1;
    }

    // best-so-far trail in the algorithm color (distinct from the white
    // movement arrows); each segment is one hop of the best position
    if (trail.length > 0) {
      ctx.strokeStyle = color;
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
      ctx.fillStyle = color;
      for (let i = 0; i < trail.length; i++) {
        const [x0, y0] = px(trail[i]);
        ctx.globalAlpha = 0.25 + 0.6 * (i / trail.length);
        ctx.beginPath();
        ctx.arc(x0, y0, 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // population points: dots tween from the previous generation to the
    // new one (along the movement arrows) while the transition runs.
    // During the live farthest-point walk the LHS overlay above already
    // drew the pool, so skip the generic layer to avoid overpainting it.
    const reorderInProgress =
      !!ops &&
      ops.type === "lhs" &&
      ops.stage === "reorder" &&
      ops.order != null;
    if (positions && positions.length > 0 && !reorderInProgress) {
      const t = transition && transition.any ? easeOutCubic(animT) : 1;
      // CMA-ES rank selection: the best-mu offspring carry a green ring
      const selFlags =
        ops && ops.type === "cmaes" ? (ops.sel_flags ?? null) : null;
      positions.forEach((raw, i) => {
        let [xn, yn] = norm(raw);
        if (t < 1 && transition && transition.match[i] >= 0) {
          const [px0, py0] = transition.prev[transition.match[i]];
          xn = px0 + (xn - px0) * t;
          yn = py0 + (yn - py0) * t;
        }
        const x = xn * W;
        const y = H - yn * H;
        ctx.beginPath();
        ctx.arc(x, y, POINT_R, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = selFlags?.[i] ? "#4ade80" : "rgba(255,255,255,0.85)";
        ctx.stroke();
      });
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

      if (highlightResult) {
        // end of the run: emphasize the best returned result with a
        // filled disc, double ring and label
        ctx.save();
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(bx, by, BEST_R - 1, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(0,0,0,0.8)";
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(bx, by, BEST_R + 4, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 0.55;
        ctx.beginPath();
        ctx.arc(bx, by, BEST_R + 9, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.fillStyle = "rgba(255,255,255,0.95)";
        ctx.font = "700 10px ui-monospace, monospace";
        ctx.fillText("result", bx + BEST_R + 12, by + 4);
        ctx.restore();
      }
    }

    // bounds caption (the trace's decision-space domain)
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.font = "10px ui-monospace, monospace";
    ctx.fillText(
      `x ${traceBounds.lo[0].toFixed(1)}..${traceBounds.hi[0].toFixed(1)}  y ${traceBounds.lo[1].toFixed(1)}..${traceBounds.hi[1].toFixed(1)}`,
      8,
      H - 8,
    );
  }, [
    size,
    heat,
    positions,
    prevPositions,
    trail,
    bestX,
    ops,
    surface,
    traceBounds,
    color,
    transition,
    animT,
    highlightResult,
  ]);

  return (
    <div ref={wrapRef} className={className ?? "relative h-full w-full"}>
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  );
}
