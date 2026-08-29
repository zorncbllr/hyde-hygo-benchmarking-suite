import { create } from "zustand";
import type {
  ActiveRunResponse,
  AlgoKey,
  CompleteEvent,
  RunDoneEvent,
  ScenarioDoneEvent,
  StartedEvent,
  TelemetryEvent,
} from "@/lib/schemas";
import { ALGO_KEYS } from "@/lib/schemas";

export const MAX_ROWS = 200;

export interface LiveRow {
  key: string;
  fname: string;
  dim: number;
  algo_key: string;
  run_idx: number;
  n_runs: number;
  best_cost: number;
  wall_ms: number;
  conv_gen: number | null;
}

export interface ScenarioSummary {
  key: string;
  best_algo: string;
  medians: Record<string, number>;
}

export type LiveStatus =
  "idle" | "running" | "completed" | "cancelled" | "error";

export interface AlgoStat {
  /** session-best cost observed for the current scenario */
  best: number;
  /** latest emitted best cost */
  last: number;
  gen: number | null;
  evals: number;
  runIdx: number;
}

interface LiveState {
  runId: string | null;
  status: LiveStatus;
  error: string | null;
  totalRuns: number;
  completedRuns: number;
  scenarios: number;
  scenariosDone: number;
  elapsedS: number;
  currentScenario: string | null;
  currentScenarioDim: number | null;
  currentAlgo: string | null;
  /** last scenario seen with dim === 2 (for 3D preview fallback) */
  last2DScenario: string | null;
  /** per-algorithm performance stats for the current scenario */
  algoStats: Record<string, AlgoStat>;
  rows: LiveRow[];
  curves: Record<string, number[]>;
  bestCosts: Record<string, number>;
  scenarioSummaries: ScenarioSummary[];
  /** latest population snapshot per algo (2D scenarios only) */
  positions: Record<string, Array<[number, number]>>;
  /** best-known position history per algo, capped (2D scenarios only) */
  trajectories: Record<string, Array<[number, number]>>;
  applyStarted: (p: StartedEvent) => void;
  /** Authoritative sync from get_active_run (late mounts miss events). */
  syncActive: (p: ActiveRunResponse) => void;
  applyTelemetry: (p: TelemetryEvent) => void;
  applyRunDone: (p: RunDoneEvent) => void;
  applyScenarioDone: (p: ScenarioDoneEvent) => void;
  applyComplete: (p: CompleteEvent) => void;
  applyCancelled: () => void;
  applyError: (error: string) => void;
  reset: () => void;
}

const initial = {
  runId: null,
  status: "idle" as LiveStatus,
  error: null as string | null,
  totalRuns: 0,
  completedRuns: 0,
  scenarios: 0,
  scenariosDone: 0,
  elapsedS: 0,
  currentScenario: null as string | null,
  currentScenarioDim: null as number | null,
  currentAlgo: null as string | null,
  last2DScenario: null as string | null,
  algoStats: {} as Record<string, AlgoStat>,
  rows: [] as LiveRow[],
  curves: {} as Record<string, number[]>,
  bestCosts: {} as Record<string, number>,
  scenarioSummaries: [] as ScenarioSummary[],
  positions: {} as Record<string, Array<[number, number]>>,
  trajectories: {} as Record<string, Array<[number, number]>>,
};

export const useLiveStore = create<LiveState>((set, get) => ({
  ...initial,

  applyStarted: (p) =>
    set({
      runId: p.run_id,
      status: "running",
      error: null,
      totalRuns: p.total_runs,
      scenarios: p.scenarios,
      scenariosDone: 0,
      completedRuns: 0,
      rows: [],
      curves: {},
      bestCosts: {},
      scenarioSummaries: [],
      positions: {},
      trajectories: {},
      algoStats: {},
    }),

  syncActive: (p) => {
    if (!p.active || !p.run_id) return;
    const state = get();
    // If events were already flowing, keep richer local state; only fill gaps.
    set({
      runId: p.run_id,
      status: "running",
      error: null,
      totalRuns: state.totalRuns || p.total_runs,
      completedRuns: Math.max(state.completedRuns, p.completed_runs),
      scenarios: state.scenarios || p.scenarios,
      scenariosDone: Math.max(state.scenariosDone, p.scenarios_done),
      currentScenario: p.current_fname,
      currentScenarioDim: p.current_dim,
      currentAlgo: p.current_algo,
      last2DScenario:
        p.current_dim === 2 ? p.current_fname : state.last2DScenario,
    });
  },

  applyTelemetry: (p) => {
    const state = get();
    const scenarioChanged =
      state.currentScenario !== p.fname || state.currentScenarioDim !== p.dim;
    const curves = scenarioChanged ? {} : { ...state.curves };
    if (p.gen_best_tail.length > 0) {
      curves[p.algo_key] = p.gen_best_tail;
    }
    const positions = scenarioChanged ? {} : { ...state.positions };
    if (p.positions && p.positions.length > 0) {
      positions[p.algo_key] = p.positions;
    }
    const trajectories = scenarioChanged ? {} : { ...state.trajectories };
    if (p.best_pos) {
      const trail = [...(trajectories[p.algo_key] ?? []), p.best_pos];
      trajectories[p.algo_key] =
        trail.length > 500 ? trail.slice(trail.length - 500) : trail;
    }
    const algoStats = scenarioChanged ? {} : { ...state.algoStats };
    const prev = algoStats[p.algo_key];
    algoStats[p.algo_key] = {
      best: Math.min(prev?.best ?? Infinity, p.best_cost),
      last: p.best_cost,
      gen: p.gen,
      evals: p.eval_count,
      runIdx: p.run_idx,
    };
    set({
      currentScenario: p.fname,
      currentScenarioDim: p.dim,
      currentAlgo: p.algo_key,
      last2DScenario: p.dim === 2 ? p.fname : state.last2DScenario,
      curves,
      positions,
      trajectories,
      algoStats,
      bestCosts: {
        ...state.bestCosts,
        [p.algo_key]: Math.min(
          state.bestCosts[p.algo_key] ?? Infinity,
          p.best_cost,
        ),
      },
    });
  },

  applyRunDone: (p) => {
    const state = get();
    const row: LiveRow = {
      key: `${p.fname}_${p.dim}D::${p.algo_key}::${p.run_idx}`,
      fname: p.fname,
      dim: p.dim,
      algo_key: p.algo_key,
      run_idx: p.run_idx,
      n_runs: p.n_runs,
      best_cost: p.best_cost,
      wall_ms: p.wall_ms,
      conv_gen: p.conv_gen,
    };
    set({
      runId: state.runId ?? p.run_id,
      totalRuns: state.totalRuns || p.total,
      completedRuns: Math.max(p.completed, state.completedRuns + 1),
      rows: [row, ...state.rows].slice(0, MAX_ROWS),
    });
  },

  applyScenarioDone: (p) =>
    set((s) => ({
      scenariosDone: s.scenariosDone + 1,
      scenarioSummaries: [
        { key: p.key, best_algo: p.best_algo, medians: p.medians },
        ...s.scenarioSummaries,
      ],
    })),

  applyComplete: (p) => set({ status: "completed", elapsedS: p.duration_s }),

  applyCancelled: () => set({ status: "cancelled" }),

  applyError: (error) => set({ status: "error", error }),

  reset: () => set(initial),
}));

export function overallProgress(state: LiveState): number {
  if (state.totalRuns === 0) return 0;
  return Math.min(100, (state.completedRuns / state.totalRuns) * 100);
}

export function activeAlgos(state: LiveState): AlgoKey[] {
  const present = new Set(state.rows.map((r) => r.algo_key));
  return ALGO_KEYS.filter((k) => present.has(k) || state.curves[k]?.length);
}
