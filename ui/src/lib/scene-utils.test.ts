import { describe, expect, it } from "vitest";
import {
  easeOutCubic,
  lhsStrataEdges,
  lhsStratumIndex,
  matchNearest,
} from "@/lib/scene-utils";

describe("lhsStrataEdges", () => {
  it("returns uniform edges including 0 and 1 for decision-space sampling", () => {
    const edges = lhsStrataEdges(4, false);
    expect(edges).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });

  it("warps edges through sin^2 for qubit theta-space sampling", () => {
    const edges = lhsStrataEdges(4, true);
    // sin^2(pi/4) = 0.5: the middle edge stays centered, outer edges are
    // pushed toward the bounds (sin^2 is steep near 0 and pi/2)
    expect(edges[0]).toBe(0);
    expect(edges[2]).toBeCloseTo(0.5, 12);
    expect(edges[1]).toBeCloseTo(Math.sin(Math.PI / 8) ** 2, 12);
    expect(edges[4]).toBe(1);
    expect(edges[1]).toBeLessThan(0.25);
    expect(edges[3]).toBeGreaterThan(0.75);
  });

  it("clamps degenerate strata counts", () => {
    expect(lhsStrataEdges(0, false)).toEqual([0, 1]);
    expect(lhsStrataEdges(-3, true)).toEqual([0, 1]);
    expect(lhsStrataEdges(2.7, false)).toEqual([0, 0.5, 1]);
  });
});

describe("lhsStratumIndex", () => {
  it("buckets uniform positions by floor(t * strata)", () => {
    expect(lhsStratumIndex(0.1, 4, false)).toBe(0);
    expect(lhsStratumIndex(0.3, 4, false)).toBe(1);
    expect(lhsStratumIndex(0.99, 4, false)).toBe(3);
  });

  it("is the inverse of the qubit edge warp", () => {
    const strata = 8;
    for (let i = 0; i < strata; i++) {
      const midEdge =
        (lhsStrataEdges(strata, true)[i] +
          lhsStrataEdges(strata, true)[i + 1]) /
        2;
      expect(lhsStratumIndex(midEdge, strata, true)).toBe(i);
    }
  });

  it("clamps out-of-range positions into the outer strata", () => {
    expect(lhsStratumIndex(-0.5, 4, false)).toBe(0);
    expect(lhsStratumIndex(1.5, 4, false)).toBe(3);
    expect(lhsStratumIndex(1.5, 4, true)).toBe(3);
  });

  it("snaps through the discrete encoding grid when levels are given", () => {
    // with 4096 levels and 24 strata, a point near a stratum edge rounds
    // to the grid level it encodes onto — the stratum follows the level,
    // not the raw position
    const strata = 24;
    const levels = 4096;
    // mid-stratum point stays put
    expect(lhsStratumIndex(0.5 / strata + 0.01, strata, false, levels)).toBe(0);
    // a point just inside the next stratum's edge but rounding across it
    const edge = 1 / strata - 1e-9;
    expect(lhsStratumIndex(edge, strata, false, levels)).toBe(1);
    // floor without levels would still report the old stratum
    expect(lhsStratumIndex(edge, strata, false)).toBe(0);
  });

  it("keeps floor semantics when levels are absent (raw LHS draw)", () => {
    expect(lhsStratumIndex(0.24, 24, false)).toBe(5);
  });
});

describe("matchNearest", () => {
  it("matches each point to its nearest unused predecessor", () => {
    const cur: Array<[number, number]> = [
      [0.1, 0.1],
      [0.5, 0.5],
    ];
    const prev: Array<[number, number]> = [
      [0.11, 0.11],
      [0.52, 0.52],
    ];
    expect(matchNearest(cur, prev)).toEqual([0, 1]);
  });

  it("never reuses a predecessor", () => {
    // both current points are nearest to prev[0]; the first claims it,
    // the second must fall back to prev[1] (within the cap)
    const cur: Array<[number, number]> = [
      [0.1, 0.1],
      [0.12, 0.12],
    ];
    const prev: Array<[number, number]> = [
      [0.1, 0.1],
      [0.2, 0.2],
    ];
    expect(matchNearest(cur, prev)).toEqual([0, 1]);
  });

  it("returns -1 for points beyond the distance cap (recovery jumps)", () => {
    const cur: Array<[number, number]> = [[0.9, 0.9]];
    const prev: Array<[number, number]> = [[0.1, 0.1]];
    expect(matchNearest(cur, prev, 0.2)).toEqual([-1]);
  });

  it("handles empty inputs", () => {
    expect(matchNearest([], [])).toEqual([]);
    expect(matchNearest([[0, 0]], [])).toEqual([-1]);
  });
});

describe("easeOutCubic", () => {
  it("starts at 0, ends at 1, decelerates", () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(0.5)).toBeCloseTo(0.875, 12);
    expect(easeOutCubic(0.25)).toBeGreaterThan(0.25);
  });

  it("clamps out-of-range inputs", () => {
    expect(easeOutCubic(-1)).toBe(0);
    expect(easeOutCubic(2)).toBe(1);
  });
});
