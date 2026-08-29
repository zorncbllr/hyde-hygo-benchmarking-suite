import { describe, expect, it } from "vitest";
import {
  benchmarkConfigSchema,
  pongResponseSchema,
  scenarioPayloadSchema,
  testCaseSchema,
} from "./schemas";

describe("pongResponseSchema", () => {
  it("accepts a valid payload", () => {
    expect(pongResponseSchema.parse({ message: "pong: x" })).toEqual({
      message: "pong: x",
    });
  });

  it("rejects a missing message", () => {
    expect(() => pongResponseSchema.parse({})).toThrow();
  });
});

describe("testCaseSchema", () => {
  it("rejects out-of-range dimensions", () => {
    expect(() => testCaseSchema.parse({ fname: "sphere", dim: 1 })).toThrow();
    expect(() => testCaseSchema.parse({ fname: "sphere", dim: 200 })).toThrow();
  });
});

describe("benchmarkConfigSchema", () => {
  const valid = {
    label: "test",
    test_cases: [{ fname: "sphere", dim: 2 }],
    n_runs: 50,
    max_evals: 50_000,
    alpha: 0.05,
    seed_base: 0,
    algo_params: {
      hyde: { max_gen: 50, phase_split: 0.6, Nb: 12 },
      hygo: {
        Nb: 12,
        NG: 50,
        Nexplor: 70,
        Nexploit: 30,
        Ne: 1,
        ps: 0.5,
        Pc: 0.55,
        Pm: 0.45,
        Pr: 0.0,
      },
    },
  };

  it("accepts CLI defaults", () => {
    expect(() => benchmarkConfigSchema.parse(valid)).not.toThrow();
  });

  it("rejects empty scenario selection", () => {
    expect(() =>
      benchmarkConfigSchema.parse({ ...valid, test_cases: [] }),
    ).toThrow();
  });

  it("rejects out-of-range n_runs", () => {
    expect(() =>
      benchmarkConfigSchema.parse({ ...valid, n_runs: 0 }),
    ).toThrow();
    expect(() =>
      benchmarkConfigSchema.parse({ ...valid, n_runs: 501 }),
    ).toThrow();
  });

  it("rejects out-of-range max_evals", () => {
    expect(() =>
      benchmarkConfigSchema.parse({ ...valid, max_evals: 500 }),
    ).toThrow();
  });

  it("rejects out-of-range alpha", () => {
    expect(() =>
      benchmarkConfigSchema.parse({ ...valid, alpha: 0.5 }),
    ).toThrow();
  });
});

describe("scenarioPayloadSchema", () => {
  it("accepts a payload with replay histories", () => {
    const payload = {
      raw_costs: [1],
      raw_wall_ms: [1],
      raw_evals: [1],
      raw_aucs: [1],
      raw_obj_errors: [1],
      mean_curve: [1],
      curves: [[1]],
      conv_binary: [1],
      global_opt: 0,
      replay_histories: [[{ g: 0, p: [0.5, 0.5], c: [[0.1, 0.2]] }]],
    };
    expect(() => scenarioPayloadSchema.parse(payload)).not.toThrow();
  });

  it("accepts payloads without replay histories (older runs)", () => {
    const payload = {
      raw_costs: [1],
      raw_wall_ms: [1],
      raw_evals: [1],
      raw_aucs: [1],
      raw_obj_errors: [1],
      mean_curve: [1],
      curves: [[1]],
      conv_binary: [1],
      global_opt: 0,
    };
    expect(() => scenarioPayloadSchema.parse(payload)).not.toThrow();
  });
});
