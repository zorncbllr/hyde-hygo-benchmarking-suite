import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useLiveStore } from "@/stores/live";
import {
  TELEMETRY_FLUSH_MS,
  useBenchmarkEvents,
} from "@/hooks/useBenchmarkEvents";
import type { TelemetryEvent } from "@/lib/schemas";

type Listener = (payload: unknown) => void;
const listeners = new Map<string, Listener[]>();

vi.mock("@/lib/api", () => ({
  pyInvokeValidated: vi.fn(() =>
    Promise.resolve({
      active: false,
      run_id: null,
      total_runs: 0,
      completed_runs: 0,
      scenarios: 0,
      scenarios_done: 0,
      current_fname: null,
      current_dim: null,
      current_algo: null,
    }),
  ),
  subscribeValidated: vi.fn((event: string, _schema: unknown, cb: Listener) => {
    listeners.set(event, [...(listeners.get(event) ?? []), cb]);
    return Promise.resolve(() => undefined);
  }),
}));

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

function emit(event: string, payload: unknown) {
  for (const cb of listeners.get(event) ?? []) cb(payload);
}

describe("useBenchmarkEvents", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    listeners.clear();
    useLiveStore.getState().reset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("flushes telemetry at most once per window", async () => {
    renderHook(() => useBenchmarkEvents());
    await vi.runAllTimersAsync(); // let the sync effect resolve

    for (let gen = 1; gen <= 10; gen++) {
      emit("benchmark://telemetry", telemetry({ gen, eval_count: gen * 100 }));
    }
    // bursts coalesce: only one store write happens per flush window
    expect(useLiveStore.getState().curves.hygo).toBeUndefined();
    act(() => {
      vi.advanceTimersByTime(TELEMETRY_FLUSH_MS + 1);
    });
    const s = useLiveStore.getState();
    expect(s.curves.hygo).toEqual([10, 7, 5]);
    expect(s.algoStats.hygo?.gen).toBe(10); // newest event wins
  });

  it("keeps the newest event per algorithm when flushing", async () => {
    renderHook(() => useBenchmarkEvents());
    await vi.runAllTimersAsync();

    emit("benchmark://telemetry", telemetry({ algo_key: "hygo", gen: 1 }));
    emit("benchmark://telemetry", telemetry({ algo_key: "hyde_bin", gen: 1 }));
    emit("benchmark://telemetry", telemetry({ algo_key: "hygo", gen: 2 }));
    act(() => {
      vi.advanceTimersByTime(TELEMETRY_FLUSH_MS + 1);
    });
    const s = useLiveStore.getState();
    expect(s.algoStats.hygo?.gen).toBe(2);
    expect(s.algoStats.hyde_bin?.gen).toBe(1);
  });

  it("applies lifecycle events immediately without coalescing", async () => {
    renderHook(() => useBenchmarkEvents());
    await vi.runAllTimersAsync();

    emit("benchmark://started", {
      run_id: "r1",
      total_runs: 8,
      scenarios: 1,
    });
    expect(useLiveStore.getState().status).toBe("running");
    emit("benchmark://complete", { run_id: "r1", duration_s: 1, scenarios: 1 });
    expect(useLiveStore.getState().status).toBe("completed");
  });

  it("drops pending telemetry on unmount", async () => {
    const { unmount } = renderHook(() => useBenchmarkEvents());
    await vi.runAllTimersAsync();

    emit("benchmark://telemetry", telemetry());
    unmount();
    act(() => {
      vi.advanceTimersByTime(TELEMETRY_FLUSH_MS + 1);
    });
    expect(useLiveStore.getState().curves.hygo).toBeUndefined();
  });
});
