import type {
  SimOps,
  SimSnapshot,
  SimulationBeat,
  SimulationTrace,
} from "./schemas";

/**
 * Pure playback logic for the simulation page: decodes the backend's flat
 * integer trace, indexes snapshots for O(log n) lookups, builds the
 * per-step "frame" (code position + algorithm state) and provides beat /
 * phase navigation over the event stream. No React here by design, so the
 * logic is unit-testable without DOM.
 */

export type StepMode = "line" | "beat";

export interface DecodedTrace {
  n: number;
  funcIdx: Int32Array;
  linenos: Int32Array;
  evalCounts: Int32Array;
  beatIdxs: Int32Array;
}

export interface SnapshotIndex {
  evalLen: number;
  genLen: number;
  evalCount: Int32Array;
  bestCost: Float64Array;
  bestXs: Array<[number, number] | null>;
  /**
   * Per gen snapshot: lookup key. Snapshots carry the trace event index
   * they were emitted at, so playback resolves the exact intra-phase stage
   * (LHS draw -> farthest-point reorder -> evaluated pool) even though all
   * init stages share eval_count 0.
   */
  genKey: Int32Array;
  genEvalCount: Int32Array;
  genPhase: Array<string | null>;
  genGen: Array<number | null>;
  genPositions: Array<Array<[number, number]> | null>;
  genBestX: Array<[number, number] | null>;
  /**
   * For each gen snapshot: index of the nearest earlier-or-equal snapshot
   * that carries a population (positions forward-fill through phases like
   * CMA-ES that do not emit one).
   */
  genPosFilled: Int32Array;
  /**
   * Per gen snapshot: operator geometry carried by that snapshot.
   */
  genOps: Array<SimOps | null>;
  /**
   * For each gen snapshot: index of the nearest earlier-or-equal snapshot
   * that carries operator geometry (ops forward-fill independently of
   * positions: e.g. DSM emits carry ops but no population).
   */
  genOpsFilled: Int32Array;
}

/**
 * Splits snapshots into eval-kind (per-evaluation cost state) and gen-kind
 * (per-generation population) series. Lookup by eval count uses binary
 * search: the newest snapshot whose eval_count <= the queried count.
 */
export function buildSnapshotIndex(snapshots: SimSnapshot[]): SnapshotIndex {
  const evalCount: number[] = [];
  const bestCost: number[] = [];
  const bestXs: Array<[number, number] | null> = [];
  const genEvalCount: number[] = [];
  const genPhase: Array<string | null> = [];
  const genGen: Array<number | null> = [];
  const genPositions: Array<Array<[number, number]> | null> = [];
  const genBestX: Array<[number, number] | null> = [];
  const genOps: Array<SimOps | null> = [];
  const genKey: number[] = [];
  const genPosFilled: number[] = [];
  const genOpsFilled: number[] = [];
  let lastPosIdx = -1;
  let lastOpsIdx = -1;

  for (const s of snapshots) {
    if (s.kind === "eval") {
      const prev = evalCount[evalCount.length - 1] ?? -1;
      if (s.eval_count <= prev) continue; // defensive: keep series sorted
      evalCount.push(s.eval_count);
      bestCost.push(s.best_cost ?? Number.POSITIVE_INFINITY);
      bestXs.push(
        s.best_x && s.best_x.length >= 2 ? [s.best_x[0], s.best_x[1]] : null,
      );
    } else {
      const prev = genKey[genKey.length - 1] ?? -1;
      if ((s.event_idx ?? s.eval_count) < prev) continue; // defensive
      genKey.push(s.event_idx ?? s.eval_count);
      genEvalCount.push(s.eval_count);
      genPhase.push(s.phase);
      genGen.push(s.gen);
      genPositions.push(
        s.positions
          ? s.positions.map(([x, y]) => [x, y] as [number, number])
          : null,
      );
      genBestX.push(
        s.best_x && s.best_x.length >= 2 ? [s.best_x[0], s.best_x[1]] : null,
      );
      genOps.push(s.ops ?? null);
      if (s.positions) lastPosIdx = genPositions.length - 1;
      genPosFilled.push(lastPosIdx);
      if (s.ops) lastOpsIdx = genOps.length - 1;
      genOpsFilled.push(lastOpsIdx);
    }
  }

  return {
    evalLen: evalCount.length,
    genLen: genEvalCount.length,
    evalCount: Int32Array.from(evalCount),
    bestCost: Float64Array.from(bestCost),
    bestXs,
    genKey: Int32Array.from(genKey),
    genEvalCount: Int32Array.from(genEvalCount),
    genPhase,
    genGen,
    genPositions,
    genBestX,
    genOps,
    genPosFilled: Int32Array.from(genPosFilled),
    genOpsFilled: Int32Array.from(genOpsFilled),
  };
}

function lastAtMost(arr: Int32Array, len: number, value: number): number {
  let lo = 0;
  let hi = len - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid] <= value) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

/** Timeline labels/colors for the curated beat phases. */
export const PHASE_LABELS: Record<string, string> = {
  overview: "Overview",
  encode: "Encoding",
  eval: "Evaluation",
  init: "Initialization",
  de: "DE generations",
  ga: "GA stage",
  exploit: "Exploitation",
  dsm: "DSM local search",
  tunnel: "Tunneling",
  recover: "Recovery",
  cmaes: "CMA-ES",
  run: "Main loop",
  sort: "Sort & trim",
};

export const PHASE_COLORS: Record<string, string> = {
  overview: "#a1a1aa",
  encode: "#f59e0b",
  eval: "#22d3ee",
  init: "#a78bfa",
  de: "#f97316",
  ga: "#38bdf8",
  exploit: "#4ade80",
  dsm: "#4ade80",
  tunnel: "#e879f9",
  recover: "#fb7185",
  cmaes: "#facc15",
  run: "#94a3b8",
  sort: "#94a3b8",
};

export function phaseColor(phase: string | null): string {
  if (phase && PHASE_COLORS[phase]) return PHASE_COLORS[phase];
  return "#a1a1aa";
}

export function phaseLabel(phase: string | null): string {
  if (!phase) return "Untraced";
  return PHASE_LABELS[phase] ?? phase;
}

export interface SimFrame {
  idx: number;
  funcName: string;
  lineno: number;
  beat: SimulationBeat | null;
  beatIdx: number;
  phase: string | null;
  evalCount: number;
  bestCost: number;
  bestX: [number, number] | null;
  /** population of the last completed generation (decision space) */
  positions: Array<[number, number]> | null;
  /** population one generation earlier, for movement visualization */
  prevPositions: Array<[number, number]> | null;
  genNumber: number | null;
  genPhase: string | null;
  /**
   * Operator-level geometry of the current step (forward-filled through
   * snapshots that carry none): LHS strata, DE mutation inputs, recovery
   * moves, the CMA-ES distribution, GA links or the DSM simplex.
   */
  ops: SimOps | null;
  /** best-so-far curve up to the current step */
  evalCurve: Array<{ e: number; c: number }>;
  /** best-position trail up to the current step (decision space) */
  trail: Array<[number, number]>;
}

/** State of the algorithm at event index ``idx``. */
export function buildFrame(
  trace: SimulationTrace,
  decoded: DecodedTrace,
  snaps: SnapshotIndex,
  idx: number,
): SimFrame {
  const i = Math.min(Math.max(0, idx), decoded.n - 1);
  const evalCount = decoded.evalCounts[i];
  const beatIdx = decoded.beatIdxs[i];
  const beat =
    beatIdx >= 0 && beatIdx < trace.beats.length ? trace.beats[beatIdx] : null;

  const evalAt = lastAtMost(snaps.evalCount, snaps.evalLen, evalCount);
  const genAt = lastAtMost(snaps.genKey, snaps.genLen, i);

  const evalCurve: Array<{ e: number; c: number }> = [];
  for (let j = 0; j <= evalAt; j++) {
    evalCurve.push({ e: snaps.evalCount[j], c: snaps.bestCost[j] });
  }

  const trail: Array<[number, number]> = [];
  for (let j = 0; j <= evalAt; j++) {
    const bx = snaps.bestXs[j];
    if (!bx) continue;
    const last = trail[trail.length - 1];
    if (last && last[0] === bx[0] && last[1] === bx[1]) continue;
    trail.push(bx);
  }

  const posIdx = genAt >= 0 ? snaps.genPosFilled[genAt] : -1;
  // the generation completed before the one on display (movement source)
  const prevPosIdx = posIdx > 0 ? snaps.genPosFilled[posIdx - 1] : -1;
  const opsIdx = genAt >= 0 ? snaps.genOpsFilled[genAt] : -1;

  return {
    idx: i,
    funcName: trace.func_names[decoded.funcIdx[i]] ?? "?",
    lineno: decoded.linenos[i],
    beat,
    beatIdx,
    phase: beat?.phase ?? null,
    evalCount,
    bestCost: evalAt >= 0 ? snaps.bestCost[evalAt] : Number.POSITIVE_INFINITY,
    bestX: evalAt >= 0 ? snaps.bestXs[evalAt] : null,
    positions: posIdx >= 0 ? snaps.genPositions[posIdx] : null,
    prevPositions:
      prevPosIdx >= 0 && prevPosIdx !== posIdx
        ? snaps.genPositions[prevPosIdx]
        : null,
    genNumber: posIdx >= 0 ? snaps.genGen[posIdx] : null,
    genPhase: posIdx >= 0 ? snaps.genPhase[posIdx] : null,
    ops: opsIdx >= 0 ? snaps.genOps[opsIdx] : null,
    evalCurve,
    trail,
  };
}

export interface PhaseSegment {
  phase: string;
  from: number;
  /** exclusive end */
  to: number;
}

/**
 * Upper bound on timeline segments. Raw beat runs can number in the
 * thousands (e.g. HyGO's DSM alternates beats every few evaluations);
 * rendering that many elements re-renders the whole timeline on every
 * playback step and freezes the UI. Micro-runs are merged into their
 * predecessor until the count is bounded, preserving the macro structure
 * (the long, distinctive segments survive; noise collapses).
 */
export const MAX_TIMELINE_SEGMENTS = 120;

/** Contiguous phase runs over the event stream (timeline navigation). */
export function buildPhaseSegments(
  decoded: DecodedTrace,
  beats: SimulationBeat[],
): PhaseSegment[] {
  const segments: PhaseSegment[] = [];
  for (let i = 0; i < decoded.n; i++) {
    const beatIdx = decoded.beatIdxs[i];
    const phase = beatIdx >= 0 ? (beats[beatIdx]?.phase ?? "") : "";
    const last = segments[segments.length - 1];
    if (last && last.phase === phase) {
      last.to = i + 1;
    } else {
      segments.push({ phase, from: i, to: i + 1 });
    }
  }
  while (segments.length > MAX_TIMELINE_SEGMENTS) {
    let shortest = 1;
    let shortestLen = Infinity;
    for (let i = 1; i < segments.length; i++) {
      const len = segments[i].to - segments[i].from;
      if (len < shortestLen) {
        shortestLen = len;
        shortest = i;
      }
    }
    // merge the shortest segment into its predecessor; index 0 always
    // survives so the run's opening phase stays navigable
    segments[shortest - 1].to = segments[shortest].to;
    segments.splice(shortest, 1);
  }
  return segments;
}

export function segmentAt(segments: PhaseSegment[], idx: number): number {
  let lo = 0;
  let hi = segments.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (segments[mid].from <= idx) {
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return Math.max(0, hi);
}

/** Event index of the first event of the next beat (or the end). */
export function nextBeatIndex(d: DecodedTrace, idx: number): number {
  if (d.n === 0) return 0;
  const cur = d.beatIdxs[idx];
  let j = idx + 1;
  while (j < d.n - 1 && d.beatIdxs[j] === cur) j++;
  return Math.min(j, d.n - 1);
}

/** Event index of the start of the current (or previous) beat. */
export function prevBeatIndex(d: DecodedTrace, idx: number): number {
  if (d.n === 0) return 0;
  const cur = d.beatIdxs[idx];
  let j = idx;
  while (j > 0 && d.beatIdxs[j - 1] === cur) j--;
  if (j < idx) return j; // walked back to the start of the current beat
  if (j === 0) return 0;
  const prevBeat = d.beatIdxs[j - 1];
  let k = j - 1;
  while (k > 0 && d.beatIdxs[k - 1] === prevBeat) k--;
  return k;
}

/**
 * Phases whose line-by-line execution is mechanical bookkeeping (the
 * binary encode/decode grid loops and per-evaluation cost bookkeeping);
 * playback fast-forwards through contiguous stretches of these instead
 * of ticking every line.
 */
export const FAST_FORWARD_PHASES: ReadonlySet<string> = new Set([
  "encode",
  "eval",
]);

/**
 * First event index at or after ``idx`` that is not inside a
 * fast-forward phase run. If ``idx`` itself is not in one it is
 * returned unchanged; otherwise the entire contiguous run (e.g. a
 * population-wide encode/decode loop) is skipped in a single step.
 */
export function fastForwardIndex(
  d: DecodedTrace,
  beats: SimulationBeat[],
  idx: number,
): number {
  const isFast = (k: number): boolean => {
    const bi = d.beatIdxs[k];
    return bi >= 0 && FAST_FORWARD_PHASES.has(beats[bi]?.phase ?? "");
  };
  if (idx >= d.n || !isFast(idx)) return idx;
  let j = idx;
  while (j < d.n - 1 && isFast(j)) j++;
  return j;
}

/** First event of the next phase segment. */
export function nextPhaseIndex(
  decoded: DecodedTrace,
  segments: PhaseSegment[],
  idx: number,
): number {
  if (decoded.n === 0) return 0;
  const seg = segmentAt(segments, idx);
  if (seg >= segments.length - 1) return decoded.n - 1;
  return Math.min(segments[seg].to, decoded.n - 1);
}

/** First event of the current (or previous) phase segment. */
export function prevPhaseIndex(segments: PhaseSegment[], idx: number): number {
  if (segments.length === 0) return 0;
  const seg = segmentAt(segments, idx);
  if (segments[seg].from < idx) return segments[seg].from;
  if (seg === 0) return 0;
  return segments[seg - 1].from;
}

/** Per-algorithm outcome registry entry (session-scoped comparison). */
export interface SimOutcome {
  algoKey: string;
  fname: string;
  seed: number;
  maxEvals: number;
  bestCost: number;
  evals: number;
  convGen: number | null;
}
