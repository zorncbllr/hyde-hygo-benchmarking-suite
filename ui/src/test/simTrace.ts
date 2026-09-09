import type { SimulationTrace, SimOps } from "@/lib/schemas";
import type { DecodedTrace } from "@/lib/simulation";
import type { SimulationTraceLoaded } from "@/lib/simTraceCodec";

/** Mutation ops attached to the "de" gen snapshot. */
export const mutationOps: SimOps = {
  type: "mutation",
  samples: [
    {
      x: [1, 1],
      best: [0, 0],
      r1: [2, 0],
      r2: [0, 2],
      f: 0.6,
      child: [0.5, 0.5],
      accepted: true,
    },
  ],
};

/** CMA-ES distribution ops attached to the population-less cmaes snapshot. */
export const cmaesOps: SimOps = {
  type: "cmaes",
  mean: [0, 0],
  axes: [
    [1, 0],
    [0, 1],
  ],
  sigma: 0.5,
  restart: 0,
};

/** LHS init ops: raw draw before farthest-point reordering. */
export const lhsSampleOps: SimOps = {
  type: "lhs",
  strata: 2,
  reorder: true,
  stage: "sample",
};

/**
 * Builds a small but structurally realistic loaded simulation trace for
 * tests: 2 beats ("de" and "recover"), 6 events, eval snapshots at eval
 * counts 1/3/5 and gen snapshots at 1/6. The decoded events mirror the
 * packed payload fields (which are dummies here; the codec has its own
 * roundtrip test).
 */
export function makeTrace(
  overrides: Partial<SimulationTrace> = {},
): SimulationTraceLoaded {
  const source = [
    "class DemoAlgo:",
    '    """Class docstring here."""',
    "",
    "    def _de_gen(self):",
    "        mutants = pop + F * d",
    "        mask = rng < cr",
    "        better = child_f <= fitness",
    "",
    "    def _recover(self):",
    "        worst = np.argsort(fitness)[-n_t:]",
    "        pop[idx] = pop[idx] + sig",
    "",
    "    def run(self):",
    "        for g in range(1, max_gen + 1):",
    "            _de_gen()",
    "",
  ].join("\n");

  const base: SimulationTrace = {
    algo_key: "hyde_bin",
    fname: "sphere",
    dim: 2,
    seed: 0,
    max_evals: 6,
    pop_size: 8,
    lo: [-5, -5],
    hi: [5, 5],
    source,
    func_names: ["run", "_de_gen", "_recover"],
    n_events: 6,
    events_payload: { func: "", line: "", eval_count: "", beat: "" },
    beats: [
      {
        phase: "de",
        title: "DE mutation",
        body: "Mutation explanation.",
        start_line: 4,
        end_line: 8,
      },
      {
        phase: "recover",
        title: "Recovery",
        body: "Recovery explanation.",
        start_line: 9,
        end_line: 12,
      },
    ],
    snapshots: [
      {
        kind: "eval",
        event_idx: 0,
        eval_count: 1,
        best_cost: 10,
        best_x: [1, 2],
        phase: null,
        gen: null,
        positions: null,
        ops: null,
      },
      {
        kind: "gen",
        event_idx: 0,
        eval_count: 1,
        best_cost: 10,
        best_x: [1, 2],
        phase: "init",
        gen: 0,
        positions: [
          [0, 0],
          [2, 2],
        ],
        ops: lhsSampleOps,
      },
      {
        kind: "eval",
        event_idx: 1,
        eval_count: 3,
        best_cost: 4,
        best_x: [0, 1],
        phase: null,
        gen: null,
        positions: null,
        ops: null,
      },
      {
        kind: "eval",
        event_idx: 2,
        eval_count: 5,
        best_cost: 2,
        best_x: [-1, 0],
        phase: null,
        gen: null,
        positions: null,
        ops: null,
      },
      {
        kind: "gen",
        event_idx: 4,
        eval_count: 6,
        best_cost: 1,
        best_x: [0, 0],
        phase: "de",
        gen: 2,
        positions: [[1, 1]],
        ops: mutationOps,
      },
      {
        // phase that emits no population (e.g. CMA-ES); positions must
        // forward-fill to the previous generation while ops carry the
        // live sampling distribution
        kind: "gen",
        event_idx: 5,
        eval_count: 6,
        best_cost: 1,
        best_x: [0, 0],
        phase: "cmaes",
        gen: null,
        positions: null,
        ops: cmaesOps,
      },
    ],
    result: { best_cost: 1, best_x: [0, 0], evals: 6, conv_gen: 2 },
    truncated: false,
    ...overrides,
  };

  // events: [func_idx, lineno, eval_count] per event; beat index per event
  const funcIdx = Int32Array.from([1, 1, 2, 1, 1, 0]);
  const linenos = Int32Array.from([5, 7, 10, 5, 7, 15]);
  const evalCounts = Int32Array.from([1, 3, 5, 6, 6, 6]);
  const beatIdxs = Int32Array.from([0, 0, 1, 0, 0, -1]);
  const decoded: DecodedTrace = {
    n: 6,
    funcIdx,
    linenos,
    evalCounts,
    beatIdxs,
  };

  return { ...base, decoded };
}
