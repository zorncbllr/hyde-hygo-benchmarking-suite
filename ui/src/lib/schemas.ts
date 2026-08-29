import { z } from "zod";

export const pongResponseSchema = z.object({
  message: z.string(),
});

export type PongResponse = z.infer<typeof pongResponseSchema>;

export const runStatusSchema = z.enum([
  "draft",
  "running",
  "completed",
  "failed",
  "cancelled",
]);

export type RunStatus = z.infer<typeof runStatusSchema>;

export const testCaseSchema = z.object({
  fname: z.string().min(1),
  dim: z.number().int().min(2).max(100),
});

export type TestCase = z.infer<typeof testCaseSchema>;

export const hydeParamsSchema = z.object({
  max_gen: z.number().int().min(1).max(1000),
  phase_split: z.number().min(0.1).max(0.9),
  Nb: z.number().int().min(1).max(64),
});

export type HydeParams = z.infer<typeof hydeParamsSchema>;

export const hygoParamsSchema = z.object({
  Nb: z.number().int().min(1).max(64),
  NG: z.number().int().min(1).max(1000),
  Nexplor: z.number().int().min(1).max(10000),
  Nexploit: z.number().int().min(0).max(10000),
  Ne: z.number().int().min(0).max(100),
  ps: z.number().min(0).max(1),
  Pc: z.number().min(0).max(1),
  Pm: z.number().min(0).max(1),
  Pr: z.number().min(0).max(1),
});

export type HygoParams = z.infer<typeof hygoParamsSchema>;

export const algoParamsSchema = z.object({
  hyde: hydeParamsSchema,
  hygo: hygoParamsSchema,
});

export type AlgoParams = z.infer<typeof algoParamsSchema>;

export const benchmarkConfigSchema = z.object({
  label: z.string().min(1).max(256),
  test_cases: z.array(testCaseSchema).min(1, "Select at least one scenario"),
  n_runs: z.number().int().min(1).max(500),
  max_evals: z.number().int().min(1000).max(10_000_000),
  alpha: z.number().min(0.001).max(0.2),
  seed_base: z.number().int().min(0),
  algo_params: algoParamsSchema,
});

export type BenchmarkConfig = z.infer<typeof benchmarkConfigSchema>;

export const startBenchmarkResponseSchema = z.object({
  run_id: z.string(),
});

export type StartBenchmarkResponse = z.infer<
  typeof startBenchmarkResponseSchema
>;

export const okResponseSchema = z.object({
  ok: z.boolean(),
});

export type OkResponse = z.infer<typeof okResponseSchema>;

export const surfaceResponseSchema = z.object({
  xs: z.array(z.number()),
  ys: z.array(z.number()),
  zs: z.array(z.array(z.number())),
  lo: z.array(z.number()),
  hi: z.array(z.number()),
});

export type SurfaceResponse = z.infer<typeof surfaceResponseSchema>;

// -- Benchmark event payloads (mirror of src/suite/schemas.py) -------------------

export const startedEventSchema = z.object({
  run_id: z.string(),
  total_runs: z.number().int(),
  scenarios: z.number().int(),
});

export type StartedEvent = z.infer<typeof startedEventSchema>;

export const telemetryEventSchema = z.object({
  run_id: z.string(),
  fname: z.string(),
  dim: z.number().int(),
  algo_key: z.string(),
  run_idx: z.number().int(),
  n_runs: z.number().int(),
  phase: z.string(),
  gen: z.number().int().nullable(),
  eval_count: z.number().int(),
  best_cost: z.number(),
  gen_best_tail: z.array(z.number()),
  positions: z.array(z.tuple([z.number(), z.number()])).nullable(),
  best_pos: z.tuple([z.number(), z.number()]).nullable(),
});

export type TelemetryEvent = z.infer<typeof telemetryEventSchema>;

export const runDoneEventSchema = z.object({
  run_id: z.string(),
  fname: z.string(),
  dim: z.number().int(),
  algo_key: z.string(),
  run_idx: z.number().int(),
  n_runs: z.number().int(),
  best_cost: z.number(),
  wall_ms: z.number(),
  conv_gen: z.number().int().nullable(),
  completed: z.number().int(),
  total: z.number().int(),
});

export type RunDoneEvent = z.infer<typeof runDoneEventSchema>;

export const scenarioDoneEventSchema = z.object({
  run_id: z.string(),
  key: z.string(),
  elapsed_s: z.number(),
  best_algo: z.string(),
  medians: z.record(z.string(), z.number()),
});

export type ScenarioDoneEvent = z.infer<typeof scenarioDoneEventSchema>;

export const completeEventSchema = z.object({
  run_id: z.string(),
  duration_s: z.number(),
  scenarios: z.number().int(),
});

export type CompleteEvent = z.infer<typeof completeEventSchema>;

export const cancelledEventSchema = z.object({
  run_id: z.string(),
});

export const activeRunResponseSchema = z.object({
  active: z.boolean(),
  run_id: z.string().nullable(),
  total_runs: z.number().int(),
  completed_runs: z.number().int(),
  scenarios: z.number().int(),
  scenarios_done: z.number().int(),
  current_fname: z.string().nullable(),
  current_dim: z.number().nullable(),
  current_algo: z.string().nullable(),
});

export type ActiveRunResponse = z.infer<typeof activeRunResponseSchema>;

export const errorEventSchema = z.object({
  run_id: z.string(),
  error: z.string(),
});

// -- Run history (mirror of src/suite/db + commands responses) -------------------

export const runRowSchema = z.object({
  id: z.string(),
  label: z.string(),
  status: z.string(),
  created_at: z.string(),
  duration_s: z.number().nullable(),
  output_dir: z.string(),
  n_runs: z.number().int(),
  max_evals: z.number().int(),
  alpha: z.number(),
  scenarios: z.number().int(),
  tags: z.array(z.string()),
});

export type RunRow = z.infer<typeof runRowSchema>;

export const listRunsRequestSchema = z.object({
  status: z.string().nullable().optional(),
  tag: z.string().nullable().optional(),
  search: z.string().nullable().optional(),
  sort: z
    .enum(["created_at", "label", "duration_s", "status", "n_runs"])
    .default("created_at"),
  order: z.enum(["asc", "desc"]).default("desc"),
  page: z.number().int().min(1).default(1),
  per_page: z.number().int().min(1).max(100).default(20),
});

export type ListRunsRequest = z.infer<typeof listRunsRequestSchema>;

export const listRunsResponseSchema = z.object({
  items: z.array(runRowSchema),
  total: z.number().int(),
  page: z.number().int(),
  per_page: z.number().int(),
});

export type ListRunsResponse = z.infer<typeof listRunsResponseSchema>;

export const scenarioResultRowSchema = z.object({
  fname: z.string(),
  dim: z.number().int(),
  algo_key: z.string(),
  payloads_path: z.string(),
  converged_all: z.boolean(),
  conv_pct: z.number(),
  // derived metrics may be NULL (undefined for single-run experiments)
  mean_best: z.number().nullable(),
  median_best: z.number().nullable(),
  std_best: z.number().nullable(),
  min_best: z.number().nullable(),
  max_best: z.number().nullable(),
  iqr_best: z.number().nullable(),
  cv: z.number().nullable(),
  mean_obj_error: z.number().nullable(),
  std_obj_error: z.number().nullable(),
  mean_conv_gen: z.number().nullable(),
  mean_auc: z.number().nullable(),
  std_auc: z.number().nullable(),
  mean_evals: z.number().nullable(),
  mean_wall_ms: z.number().nullable(),
  median_wall_ms: z.number().nullable(),
  evals_per_ms: z.number().nullable(),
});

export type ScenarioResultRow = z.infer<typeof scenarioResultRowSchema>;

export const runDetailResponseSchema = z.object({
  id: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  label: z.string(),
  notes: z.string().nullable(),
  status: z.string(),
  duration_s: z.number().nullable(),
  output_dir: z.string(),
  seed_base: z.number().int(),
  n_runs: z.number().int(),
  max_evals: z.number().int(),
  alpha: z.number(),
  algo_params: z.record(z.string(), z.unknown()).nullable(),
  test_cases: z.array(testCaseSchema),
  scenario_results: z.array(scenarioResultRowSchema),
  tags: z.array(z.string()),
});

export type RunDetailResponse = z.infer<typeof runDetailResponseSchema>;

export const deleteRunsResponseSchema = z.object({
  deleted: z.array(z.string()),
  artifact_dirs: z.array(z.string()),
});

export type DeleteRunsResponse = z.infer<typeof deleteRunsResponseSchema>;

// -- Export events ----------------------------------------------------------------

export const exportProgressEventSchema = z.object({
  run_id: z.string(),
  message: z.string(),
});

export type ExportProgressEvent = z.infer<typeof exportProgressEventSchema>;

export const exportDoneEventSchema = z.object({
  run_id: z.string(),
  artifacts: z.record(z.string(), z.array(z.string())),
});

export type ExportDoneEvent = z.infer<typeof exportDoneEventSchema>;

export const exportErrorEventSchema = z.object({
  run_id: z.string(),
  error: z.string(),
});

// -- Payloads ----------------------------------------------------------------------

export const scenarioPayloadSchema = z.object({
  raw_costs: z.array(z.number()),
  raw_wall_ms: z.array(z.number()),
  raw_evals: z.array(z.number()),
  raw_aucs: z.array(z.number()),
  raw_obj_errors: z.array(z.number()),
  mean_curve: z.array(z.number()),
  curves: z.array(z.array(z.number())),
  conv_binary: z.array(z.number()),
  global_opt: z.number(),
  // per-run 3D replay entries (2D scenarios only): {g: gen, p: best_pos, c: population}
  replay_histories: z
    .array(
      z.array(
        z.object({
          g: z.number().int().nullable(),
          p: z.tuple([z.number(), z.number()]).nullable(),
          c: z.array(z.tuple([z.number(), z.number()])).nullable(),
        }),
      ),
    )
    .optional(),
});

export type ScenarioPayload = z.infer<typeof scenarioPayloadSchema>;

export const scenarioPayloadsResponseSchema = z.record(
  z.string(),
  scenarioPayloadSchema,
);

// -- CLI parity constants -------------------------------------------------------

export const CLI_TEST_CASES: Array<{ fname: string; dim: number }> = [
  { fname: "ackley", dim: 2 },
  { fname: "ackley", dim: 25 },
  { fname: "beale", dim: 2 },
  { fname: "booth", dim: 2 },
  { fname: "bukin", dim: 2 },
  { fname: "easom", dim: 2 },
  { fname: "eggholder", dim: 2 },
  { fname: "goldstein_price", dim: 2 },
  { fname: "himmelblau", dim: 2 },
  { fname: "holder_table", dim: 2 },
  { fname: "levi", dim: 2 },
  { fname: "matyas", dim: 2 },
  { fname: "sphere", dim: 2 },
  { fname: "sphere", dim: 25 },
  { fname: "rastrigin", dim: 2 },
  { fname: "rastrigin", dim: 25 },
  { fname: "rosenbrock", dim: 2 },
  { fname: "rosenbrock", dim: 25 },
  { fname: "styblinski_tang", dim: 2 },
  { fname: "styblinski_tang", dim: 25 },
];

export const BENCH_FUNCTIONS = [
  "ackley",
  "sphere",
  "rastrigin",
  "rosenbrock",
  "styblinski_tang",
  "beale",
  "booth",
  "bukin",
  "easom",
  "eggholder",
  "goldstein_price",
  "himmelblau",
  "holder_table",
  "levi",
  "matyas",
] as const;

export const ALGO_KEYS = ["hyde_bin", "hyde_qub", "hyde_con", "hygo"] as const;
export type AlgoKey = (typeof ALGO_KEYS)[number];

export const ALGO_LABELS: Record<AlgoKey, string> = {
  hyde_bin: "HyDE-bin",
  hyde_qub: "HyDE-qub",
  hyde_con: "HyDE-con",
  hygo: "HyGO",
};

export const ALGO_COLORS: Record<AlgoKey, string> = {
  hyde_bin: "#f97316",
  hyde_qub: "#38bdf8",
  hyde_con: "#4ade80",
  hygo: "#a78bfa",
};

export const CLI_DEFAULTS = {
  nRuns: 50,
  maxEvals: 50_000,
  alpha: 0.05,
  seedBase: 0,
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
} as const;
