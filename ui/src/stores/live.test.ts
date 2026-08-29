import { beforeEach, describe, expect, it } from "vitest";
import type {
  RunDoneEvent,
  ScenarioDoneEvent,
  StartedEvent,
  TelemetryEvent,
} from "@/lib/schemas";
import { overallProgress, useLiveStore } from "@/stores/live";

function telemetry(overrides: Partial<TelemetryEvent> = {}): TelemetryEvent {
  return {
    run_id: "r1",
    fname: "booth",
    dim: 2,
    algo_key: "hygo",
    run_idx: 0,
    n_runs: 2,
    phase: "de",
    gen: 1,
    eval_count: 100,
    best_cost: 5,
    gen_best_tail: [10, 7, 5],
    positions: [
      [1, 2],
      [3, 4],
    ],
    best_pos: [0.5, 0.5],
    ...overrides,
  };
}

function started(overrides: Partial<StartedEvent> = {}): StartedEvent {
  return { run_id: "r1", total_runs: 8, scenarios: 1, ...overrides };
}

function runDone(overrides: Partial<RunDoneEvent> = {}): RunDoneEvent {
  return {
    run_id: "r1",
    fname: "booth",
    dim: 2,
    algo_key: "hygo",
    run_idx: 0,
    n_runs: 2,
    best_cost: 1,
    wall_ms: 10,
    conv_gen: null,
    completed: 1,
    total: 8,
    ...overrides,
  };
}

function scenarioDone(): ScenarioDoneEvent {
  return {
    run_id: "r1",
    key: "booth_2D",
    elapsed_s: 1,
    best_algo: "hygo",
    medians: { hygo: 1, hyde_bin: 2 },
  };
}

describe("live store", () => {
  beforeEach(() => {
    useLiveStore.getState().reset();
  });

  it("starts with idle state", () => {
    const s = useLiveStore.getState();
    expect(s.status).toBe("idle");
    expect(s.totalRuns).toBe(0);
  });

  it("started resets and sets totals", () => {
    useLiveStore.getState().applyStarted(started());
    const s = useLiveStore.getState();
    expect(s.status).toBe("running");
    expect(s.totalRuns).toBe(8);
    expect(s.runId).toBe("r1");
  });

  it("telemetry updates curves, positions and trajectories", () => {
    useLiveStore.getState().applyStarted(started());
    useLiveStore.getState().applyTelemetry(telemetry());
    const s = useLiveStore.getState();
    expect(s.curves.hygo).toEqual([10, 7, 5]);
    expect(s.positions.hygo).toHaveLength(2);
    expect(s.trajectories.hygo).toEqual([[0.5, 0.5]]);
  });

  it("telemetry updates per-algo stats with session-best tracking", () => {
    useLiveStore.getState().applyStarted(started());
    useLiveStore
      .getState()
      .applyTelemetry(telemetry({ best_cost: 5, gen: 1, eval_count: 100 }));
    useLiveStore
      .getState()
      .applyTelemetry(telemetry({ best_cost: 2, gen: 2, eval_count: 200 }));
    useLiveStore
      .getState()
      .applyTelemetry(telemetry({ best_cost: 7, gen: 3, eval_count: 300 }));
    const stats = useLiveStore.getState().algoStats.hygo;
    expect(stats.best).toBe(2);
    expect(stats.last).toBe(7);
    expect(stats.gen).toBe(3);
    expect(stats.evals).toBe(300);
  });

  it("algo stats reset on scenario change", () => {
    useLiveStore.getState().applyStarted(started());
    useLiveStore.getState().applyTelemetry(telemetry({ best_cost: 5 }));
    useLiveStore.getState().applyTelemetry(
      telemetry({
        fname: "sphere",
        dim: 25,
        positions: null,
        best_pos: null,
      }),
    );
    expect(useLiveStore.getState().algoStats.hygo).toEqual({
      best: 5,
      last: 5,
      gen: 1,
      evals: 100,
      runIdx: 0,
    });
    // stats carried into the new scenario start fresh on its first telemetry
    useLiveStore.getState().applyTelemetry(
      telemetry({
        fname: "sphere",
        dim: 25,
        best_cost: 50,
        gen: 0,
        eval_count: 70,
      }),
    );
    const stats = useLiveStore.getState().algoStats.hygo;
    expect(stats.best).toBe(5); // min(5, 50): first sphere gen was cheaper
    expect(stats.last).toBe(50);
    expect(stats.evals).toBe(70);
  });

  it("scenario change clears curves, positions and trajectories", () => {
    useLiveStore.getState().applyStarted(started());
    useLiveStore.getState().applyTelemetry(telemetry());
    useLiveStore.getState().applyTelemetry(
      telemetry({
        fname: "sphere",
        dim: 25,
        positions: null,
        best_pos: null,
      }),
    );
    const s = useLiveStore.getState();
    expect(Object.keys(s.curves)).toEqual(["hygo"]);
    expect(s.positions).toEqual({});
    expect(s.trajectories).toEqual({});
  });

  it("trajectory is capped at 500 entries", () => {
    useLiveStore.getState().applyStarted(started());
    for (let i = 0; i < 600; i++) {
      useLiveStore
        .getState()
        .applyTelemetry(telemetry({ gen: i, best_pos: [i / 600, i / 600] }));
    }
    const s = useLiveStore.getState();
    expect(s.trajectories.hygo?.length).toBe(500);
  });

  it("run done increments progress and prepends rows", () => {
    useLiveStore.getState().applyStarted(started());
    useLiveStore.getState().applyRunDone(runDone());
    useLiveStore
      .getState()
      .applyRunDone(runDone({ run_idx: 1, algo_key: "hygo" }));
    const s = useLiveStore.getState();
    expect(s.completedRuns).toBe(2);
    expect(s.rows).toHaveLength(2);
    expect(s.rows[0].run_idx).toBe(1);
  });

  it("run rows are capped at MAX_ROWS", async () => {
    useLiveStore.getState().applyStarted(started({ total_runs: 1000 }));
    for (let i = 0; i < 250; i++) {
      useLiveStore.getState().applyRunDone(runDone({ run_idx: i }));
    }
    const { MAX_ROWS } = await import("@/stores/live");
    expect(useLiveStore.getState().rows.length).toBe(MAX_ROWS);
  });

  it("scenario done appends summaries", () => {
    useLiveStore.getState().applyStarted(started());
    useLiveStore.getState().applyScenarioDone(scenarioDone());
    const s = useLiveStore.getState();
    expect(s.scenariosDone).toBe(1);
    expect(s.scenarioSummaries[0].best_algo).toBe("hygo");
  });

  it("complete and error set terminal status", () => {
    useLiveStore.getState().applyStarted(started());
    useLiveStore.getState().applyComplete({
      run_id: "r1",
      duration_s: 5,
      scenarios: 1,
    });
    expect(useLiveStore.getState().status).toBe("completed");
    useLiveStore.getState().applyStarted(started());
    useLiveStore.getState().applyError("boom");
    expect(useLiveStore.getState().status).toBe("error");
    expect(useLiveStore.getState().error).toBe("boom");
  });

  it("cancelled sets status", () => {
    useLiveStore.getState().applyStarted(started());
    useLiveStore.getState().applyCancelled();
    expect(useLiveStore.getState().status).toBe("cancelled");
  });

  it("overall progress is bounded", () => {
    const s = useLiveStore.getState();
    expect(overallProgress(s)).toBe(0);
    useLiveStore.getState().applyStarted(started());
    useLiveStore.getState().applyRunDone(runDone());
    expect(overallProgress(useLiveStore.getState())).toBe((1 / 8) * 100);
    useLiveStore.getState().applyStarted(started({ total_runs: 8 }));
    for (let i = 0; i < 10; i++) {
      useLiveStore.getState().applyRunDone(runDone({ run_idx: i }));
    }
    expect(overallProgress(useLiveStore.getState())).toBe(100);
  });
});
