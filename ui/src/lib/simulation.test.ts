import { describe, expect, it } from "vitest";
import {
  buildFrame,
  buildPhaseSegments,
  buildSnapshotIndex,
  nextBeatIndex,
  nextPhaseIndex,
  phaseColor,
  phaseLabel,
  prevBeatIndex,
  prevPhaseIndex,
  segmentAt,
  type SimOutcome,
} from "@/lib/simulation";
import { makeTrace } from "@/test/simTrace";

describe("fixture decoded events", () => {
  it("carries the expected event streams", () => {
    const trace = makeTrace();
    const d = trace.decoded;
    expect(d.n).toBe(6);
    expect(Array.from(d.funcIdx)).toEqual([1, 1, 2, 1, 1, 0]);
    expect(Array.from(d.linenos)).toEqual([5, 7, 10, 5, 7, 15]);
    expect(Array.from(d.evalCounts)).toEqual([1, 3, 5, 6, 6, 6]);
    expect(Array.from(d.beatIdxs)).toEqual([0, 0, 1, 0, 0, -1]);
  });
});

describe("buildSnapshotIndex", () => {
  it("splits eval and gen series and keeps them sorted", () => {
    const snaps = buildSnapshotIndex(makeTrace().snapshots);
    expect(snaps.evalLen).toBe(3);
    expect(snaps.genLen).toBe(3);
    expect(Array.from(snaps.evalCount)).toEqual([1, 3, 5]);
    expect(Array.from(snaps.bestCost)).toEqual([10, 4, 2]);
    expect(Array.from(snaps.genEvalCount)).toEqual([1, 6, 6]);
  });

  it("forward-fills positions through population-less phases", () => {
    const snaps = buildSnapshotIndex(makeTrace().snapshots);
    // gen 0 (init, positions) -> gen 1 (de, positions) -> gen 2 (cmaes, null)
    expect(Array.from(snaps.genPosFilled)).toEqual([0, 1, 1]);
  });

  it("drops out-of-order eval snapshots defensively", () => {
    const trace = makeTrace();
    trace.snapshots = [
      {
        kind: "eval",
        eval_count: 3,
        best_cost: 4,
        best_x: null,
        phase: null,
        gen: null,
        positions: null,
      },
      {
        kind: "eval",
        eval_count: 1,
        best_cost: 9,
        best_x: null,
        phase: null,
        gen: null,
        positions: null,
      },
      {
        kind: "eval",
        eval_count: 5,
        best_cost: 2,
        best_x: null,
        phase: null,
        gen: null,
        positions: null,
      },
    ];
    const snaps = buildSnapshotIndex(trace.snapshots);
    expect(Array.from(snaps.evalCount)).toEqual([3, 5]);
  });
});

describe("buildFrame", () => {
  it("resolves beat, cost state and population at the current step", () => {
    const trace = makeTrace();
    const d = trace.decoded;
    const snaps = buildSnapshotIndex(trace.snapshots);
    const frame = buildFrame(trace, d, snaps, 2);
    expect(frame.funcName).toBe("_recover");
    expect(frame.lineno).toBe(10);
    expect(frame.beat?.title).toBe("Recovery");
    expect(frame.phase).toBe("recover");
    expect(frame.evalCount).toBe(5);
    expect(frame.bestCost).toBe(2);
    // last gen snapshot at or before eval 5 is the init snapshot
    expect(frame.positions).toEqual([
      [0, 0],
      [2, 2],
    ]);
    expect(frame.prevPositions).toBeNull(); // init has no predecessor
    expect(frame.genNumber).toBe(0);
    expect(frame.evalCurve).toEqual([
      { e: 1, c: 10 },
      { e: 3, c: 4 },
      { e: 5, c: 2 },
    ]);
    expect(frame.trail).toEqual([
      [1, 2],
      [0, 1],
      [-1, 0],
    ]);
  });

  it("handles events before any snapshot and untraced lines", () => {
    const trace = makeTrace();
    trace.snapshots = [];
    const d = trace.decoded;
    const snaps = buildSnapshotIndex(trace.snapshots);
    const frame = buildFrame(trace, d, snaps, 5);
    expect(frame.beat).toBeNull();
    expect(frame.phase).toBeNull();
    expect(frame.bestCost).toBe(Number.POSITIVE_INFINITY);
    expect(frame.positions).toBeNull();
    expect(frame.evalCurve).toEqual([]);
  });
});

describe("phase segments", () => {
  const trace = makeTrace();
  const d = trace.decoded;
  const segments = buildPhaseSegments(d, trace.beats);

  it("groups contiguous runs of the same phase", () => {
    // phases over events: de, de, recover, de, de, "" (untraced)
    expect(segments).toEqual([
      { phase: "de", from: 0, to: 2 },
      { phase: "recover", from: 2, to: 3 },
      { phase: "de", from: 3, to: 5 },
      { phase: "", from: 5, to: 6 },
    ]);
  });

  it("locates and navigates segments", () => {
    expect(segmentAt(segments, 0)).toBe(0);
    expect(segmentAt(segments, 2)).toBe(1);
    expect(segmentAt(segments, 5)).toBe(3);
    expect(nextPhaseIndex(d, segments, 1)).toBe(2); // de -> recover
    expect(nextPhaseIndex(d, segments, 3)).toBe(5); // de -> untraced
    expect(nextPhaseIndex(d, segments, 5)).toBe(5); // last segment clamps
    expect(prevPhaseIndex(segments, 3)).toBe(2); // at segment start -> previous segment
    expect(prevPhaseIndex(segments, 4)).toBe(3);
    expect(prevPhaseIndex(segments, 5)).toBe(3); // at segment start -> previous segment
  });

  it("coalesces micro-runs when the segment count is unbounded", () => {
    // 300 events alternating between two beats -> 300 raw segments
    const n = 300;
    const noisy = makeTrace();
    const beatSeq: number[] = [];
    for (let i = 0; i < n; i++) beatSeq.push(i % 2);
    noisy.decoded = {
      n,
      funcIdx: Int32Array.from(Array(n).fill(1)),
      linenos: Int32Array.from(Array(n).fill(5)),
      evalCounts: Int32Array.from(Array(n).fill(1)),
      beatIdxs: Int32Array.from(beatSeq),
    };
    const nd = noisy.decoded;
    const coalesced = buildPhaseSegments(nd, noisy.beats);
    expect(coalesced.length).toBeLessThanOrEqual(120);
    // order + contiguity preserved, first segment intact
    expect(coalesced[0].from).toBe(0);
    for (let i = 0; i < coalesced.length; i++) {
      expect(coalesced[i].to > coalesced[i].from).toBe(true);
      if (i > 0) {
        expect(coalesced[i].from).toBe(coalesced[i - 1].to);
      }
    }
    expect(coalesced[coalesced.length - 1].to).toBe(n);
  });
});

describe("beat navigation", () => {
  const trace = makeTrace();
  const d = trace.decoded;

  it("nextBeatIndex jumps to the first event of the next beat", () => {
    expect(nextBeatIndex(d, 0)).toBe(2); // de -> recover
    expect(nextBeatIndex(d, 1)).toBe(2);
    expect(nextBeatIndex(d, 2)).toBe(3); // recover -> de
    expect(nextBeatIndex(d, 4)).toBe(5); // last event clamps
  });

  it("prevBeatIndex walks back to beat starts", () => {
    expect(prevBeatIndex(d, 1)).toBe(0); // start of current beat
    expect(prevBeatIndex(d, 0)).toBe(0); // clamps
    expect(prevBeatIndex(d, 3)).toBe(2); // previous beat start
    expect(prevBeatIndex(d, 5)).toBe(3); // start of the current de run
  });

  it("resolves the previous generation and fills through CMA-ES", () => {
    const trace = makeTrace();
    const d = trace.decoded;
    const snaps = buildSnapshotIndex(trace.snapshots);
    // event 3: eval 6 -> last completed gen is "de" gen 2
    const frame = buildFrame(trace, d, snaps, 3);
    expect(frame.positions).toEqual([[1, 1]]);
    // movement source: the previous generation's population
    expect(frame.prevPositions).toEqual([
      [0, 0],
      [2, 2],
    ]);
    expect(frame.genNumber).toBe(2);

    // a later event inside the position-less cmaes phase keeps showing
    // the same (forward-filled) population
    const frameCmaes = buildFrame(trace, d, snaps, 5);
    expect(frameCmaes.positions).toEqual([[1, 1]]);
    expect(frameCmaes.prevPositions).toEqual([
      [0, 0],
      [2, 2],
    ]);
    expect(frameCmaes.genNumber).toBe(2);
  });
});

describe("phase labels and colors", () => {
  it("maps known phases and falls back", () => {
    expect(phaseLabel("de")).toBe("DE generations");
    expect(phaseLabel("cmaes")).toBe("CMA-ES");
    expect(phaseLabel(null)).toBe("Untraced");
    expect(phaseLabel("mystery")).toBe("mystery");
    expect(phaseColor("de")).toMatch(/^#/);
    expect(phaseColor(null)).toBe("#a1a1aa");
    expect(phaseColor("mystery")).toBe("#a1a1aa");
  });
});

describe("SimOutcome", () => {
  it("records minimal fields for the session strip", () => {
    const o: SimOutcome = {
      algoKey: "hygo",
      fname: "sphere",
      seed: 0,
      maxEvals: 400,
      bestCost: 0.5,
      evals: 400,
      convGen: null,
    };
    expect(o.bestCost).toBe(0.5);
  });
});
