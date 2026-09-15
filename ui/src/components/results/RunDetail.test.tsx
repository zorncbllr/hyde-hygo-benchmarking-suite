import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import RunDetail from "./RunDetail";
import { pyInvokeValidated } from "@/lib/api";
import {
  exportDoneEventSchema,
  exportProgressEventSchema,
  exportErrorEventSchema,
  type RunDetailResponse,
} from "@/lib/schemas";
import { toast } from "sonner";

const listeners = new Map<string, (payload: unknown) => void>();

vi.mock("@/lib/api", () => ({
  pyInvokeValidated: vi.fn((cmd: string) => {
    if (cmd === "get_analysis") return Promise.reject(new Error("none"));
    if (cmd === "get_scenario_payloads") return Promise.resolve({});
    return Promise.resolve({ ok: true });
  }),
  subscribeValidated: vi.fn(
    (
      event: string,
      schema: { parse: (d: unknown) => unknown },
      cb: (p: never) => void,
    ) => {
      listeners.set(event, (payload) => cb(schema.parse(payload) as never));
      return Promise.resolve(() => listeners.delete(event));
    },
  ),
}));

vi.mock("@/lib/echarts", () => {
  const chart = { setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn() };
  return { default: { init: vi.fn(() => chart) } };
});

vi.mock("@/hooks/useSurface", () => ({
  useSurface: () => ({
    surface: { xs: [], ys: [], zs: [], lo: [0, 0], hi: [1, 1] },
    error: null,
  }),
}));

vi.mock("@/components/scene/Replay3D", () => ({
  default: () => <div data-testid="replay-3d" />,
}));

vi.mock("sonner", () => ({
  toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() },
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  revealItemInDir: vi.fn(),
}));

const detail = {
  id: "abc",
  created_at: "2026-08-29T00:00:00",
  updated_at: "2026-08-29T00:00:00",
  label: "test run",
  notes: null,
  status: "completed",
  duration_s: 10,
  output_dir: "/tmp/run",
  seed_base: 0,
  n_runs: 5,
  max_evals: 50_000,
  alpha: 0.05,
  algo_params: {},
  test_cases: [{ fname: "booth", dim: 2 }],
  scenario_results: [],
  tags: [],
} as unknown as RunDetailResponse;

function renderDetail() {
  return render(
    <RunDetail detail={detail} onChanged={() => {}} onDeleted={() => {}} />,
  );
}

function emitDone(runId: string, artifacts: Record<string, string[]>) {
  listeners.get("export://done")?.({
    run_id: runId,
    artifacts,
  });
}

const mockInvoke = vi.mocked(pyInvokeValidated);

/** Deferred promise the test resolves manually. */
function deferred<T = unknown>(): {
  promise: Promise<T>;
  resolve: (v: T) => void;
} {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

type InvokeHandlers = Partial<
  Record<string, (body: Record<string, unknown>) => Promise<unknown>>
>;

/** Replace the invoke mock with per-command handlers; unknown commands fall
 * back to a valid empty scenario-payload/ok response. */
function mockResponses(handlers: InvokeHandlers): void {
  mockInvoke.mockImplementation(
    ((cmd: string, _schema: unknown, body?: Record<string, unknown>) =>
      handlers[cmd]?.(body ?? {}) ??
      (cmd === "get_scenario_payloads"
        ? Promise.resolve({})
        : Promise.resolve({ ok: true }))) as never,
  );
}

function invokeAnalysis(
  responseFor: (runId: string) => Promise<unknown>,
): void {
  mockResponses({
    get_analysis: (body) => responseFor(String(body.run_id)),
  });
}

function openTab(name: RegExp): void {
  fireEvent.click(screen.getByRole("tab", { name }));
}

/** Minimal full payload satisfying scenarioPayloadSchema (replay included). */
const minimalPayload = {
  raw_costs: [],
  raw_wall_ms: [],
  raw_evals: [],
  raw_aucs: [],
  raw_obj_errors: [],
  mean_curve: [],
  curves: [],
  conv_binary: [],
  global_opt: 0,
  replay_histories: [[{ g: 0, p: [0, 0], c: [[0, 0]] }]],
};

const scenarioRow = {
  fname: "booth",
  dim: 2,
  algo_key: "hygo",
  payloads_path: "payloads/booth_2D_hygo.json.zst",
  converged_all: true,
  conv_pct: 100,
  mean_best: null,
  median_best: null,
  std_best: null,
  min_best: null,
  max_best: null,
  iqr_best: null,
  cv: null,
  mean_obj_error: null,
  std_obj_error: null,
  mean_conv_gen: null,
  mean_auc: null,
  std_auc: null,
  mean_evals: null,
  mean_wall_ms: null,
  median_wall_ms: null,
  evals_per_ms: null,
};

function detailWith(id: string): RunDetailResponse {
  return {
    ...detail,
    id,
    scenario_results: [scenarioRow],
  } as unknown as RunDetailResponse;
}

describe("RunDetail analyses", () => {
  beforeEach(() => {
    listeners.clear();
    vi.clearAllMocks();
  });

  it("shows a computing state while the analysis is pending", async () => {
    invokeAnalysis(() => new Promise(() => {}));
    renderDetail();
    openTab(/statistical analyses/i);
    expect(
      await screen.findByText(/Computing statistical analyses/i),
    ).toBeInTheDocument();
  });

  it("shows the placeholder when the analysis computation fails", async () => {
    invokeAnalysis(() => Promise.reject(new Error("not found")));
    renderDetail();
    openTab(/statistical analyses/i);
    expect(
      await screen.findByText(/appear here once the run finishes/i),
    ).toBeInTheDocument();
  });

  it("ignores stale analysis responses after the run selection changes", async () => {
    const stale = deferred();
    const runs: Record<string, Promise<unknown>> = { abc: stale.promise };
    invokeAnalysis((runId) => {
      if (runId in runs) return runs[runId];
      return Promise.reject(new Error("not found"));
    });
    const { rerender } = renderDetail();
    openTab(/statistical analyses/i);
    expect(
      await screen.findByText(/Computing statistical analyses/i),
    ).toBeInTheDocument();

    // switch to another run; its own request fails immediately, so the
    // pane shows the placeholder
    const other = { ...detail, id: "xyz" } as unknown as RunDetailResponse;
    rerender(
      <RunDetail detail={other} onChanged={() => {}} onDeleted={() => {}} />,
    );
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith(
        "get_analysis",
        expect.anything(),
        { run_id: "xyz" },
      );
    });
    openTab(/statistical analyses/i);
    expect(
      await screen.findByText(/appear here once the run finishes/i),
    ).toBeInTheDocument();

    // the stale response for the previous run must not clobber the pane
    stale.resolve({ friedman_objective_error: {} } as unknown);
    await act(async () => {});
    expect(
      screen.getByText(/appear here once the run finishes/i),
    ).toBeInTheDocument();
  });
});

describe("RunDetail exports", () => {
  beforeEach(() => {
    listeners.clear();
    vi.clearAllMocks();
  });

  it("registers listeners for all export event channels", async () => {
    renderDetail();
    await waitFor(() => {
      expect([...listeners.keys()]).toEqual(
        expect.arrayContaining([
          "export://progress",
          "export://done",
          "export://error",
        ]),
      );
    });
  });

  it("shows artifacts only for the run shown in the pane", async () => {
    renderDetail();
    await waitFor(() => {
      expect(listeners.has("export://done")).toBe(true);
    });

    // an event belonging to another run must be ignored
    emitDone("other-run", { csv: ["/tmp/other/benchmark_summary.csv"] });
    await waitFor(() => {
      expect(toast.success).not.toHaveBeenCalled();
    });
    expect(screen.queryByText(/benchmark_summary.csv/)).toBeNull();

    // an event for the pane's run is validated and displayed
    emitDone("abc", { csv: ["/tmp/run/csv_data/benchmark_summary.csv"] });
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith("Export finished");
    });
    expect(
      screen.getByText("/tmp/run/csv_data/benchmark_summary.csv"),
    ).toBeInTheDocument();
  });

  it("validates done payloads and drops malformed ones", async () => {
    renderDetail();
    await waitFor(() => {
      expect(listeners.has("export://done")).toBe(true);
    });
    // malformed (missing artifacts) must be dropped by the schema guard
    expect(() => exportDoneEventSchema.parse({ run_id: "abc" })).toThrow();
    // well-formed progress/error payloads parse cleanly
    expect(
      exportProgressEventSchema.parse({ run_id: "abc", message: "x" }),
    ).toBeTruthy();
    expect(
      exportErrorEventSchema.parse({ run_id: "abc", error: "e" }),
    ).toBeTruthy();
  });
});

describe("RunDetail replay", () => {
  beforeEach(() => {
    listeners.clear();
    vi.resetAllMocks();
  });

  it("does not fetch replay data until the replay tab opens", async () => {
    mockResponses({ get_payload: () => Promise.resolve(minimalPayload) });
    render(
      <RunDetail
        detail={detailWith("r1")}
        onChanged={() => {}}
        onDeleted={() => {}}
      />,
    );
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith(
        "get_scenario_payloads",
        expect.anything(),
        { run_id: "r1", scenario_key: "booth_2D" },
      );
    });
    expect(
      mockInvoke.mock.calls.filter(([cmd]) => cmd === "get_payload"),
    ).toHaveLength(0);
  });

  it("fetches the per-algorithm payload lazily and renders the replay", async () => {
    const payload = deferred<typeof minimalPayload>();
    mockResponses({ get_payload: () => payload.promise });
    render(
      <RunDetail
        detail={detailWith("r2")}
        onChanged={() => {}}
        onDeleted={() => {}}
      />,
    );
    openTab(/3d replay/i);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith(
        "get_payload",
        expect.anything(),
        { run_id: "r2", payload_path: "payloads/booth_2D_hygo.json.zst" },
      );
    });
    expect(await screen.findByText(/Loading replay data/i)).toBeInTheDocument();

    payload.resolve(minimalPayload);
    expect(await screen.findByTestId("replay-3d")).toBeInTheDocument();
  });

  it("shows an error when the replay payload fetch fails", async () => {
    mockResponses({ get_payload: () => Promise.reject(new Error("gone")) });
    render(
      <RunDetail
        detail={detailWith("r3")}
        onChanged={() => {}}
        onDeleted={() => {}}
      />,
    );
    openTab(/3d replay/i);
    expect(
      await screen.findByText(/Replay data unavailable/i),
    ).toBeInTheDocument();
  });
});

describe("RunDetail distributions loading", () => {
  beforeEach(() => {
    listeners.clear();
    vi.resetAllMocks();
  });

  it("shows a chart skeleton while payloads load, then renders", async () => {
    const payloads = deferred();
    mockResponses({ get_scenario_payloads: () => payloads.promise });
    render(
      <RunDetail
        detail={detailWith("s1")}
        onChanged={() => {}}
        onDeleted={() => {}}
      />,
    );
    expect(await screen.findByTestId("chart-skeleton")).toBeInTheDocument();
    expect(
      screen.queryByText(/Payloads not available/i),
    ).not.toBeInTheDocument();

    payloads.resolve({});
    await waitFor(() => {
      expect(screen.queryByTestId("chart-skeleton")).toBeNull();
    });
  });

  it("shows the skeleton again while the scenario refetches", async () => {
    const refetch = deferred();
    let call = 0;
    const responses: Promise<unknown>[] = [
      Promise.resolve({}),
      refetch.promise,
    ];
    mockResponses({
      get_scenario_payloads: () => responses[call++] ?? Promise.resolve({}),
    });
    const { rerender } = render(
      <RunDetail
        detail={detailWith("s2")}
        onChanged={() => {}}
        onDeleted={() => {}}
      />,
    );
    await waitFor(() => {
      expect(screen.queryByTestId("chart-skeleton")).toBeNull();
    });

    // a detail whose first scenario differs triggers a scenario switch
    const swapped = {
      ...detailWith("s2"),
      scenario_results: [
        {
          ...scenarioRow,
          fname: "beale",
          payloads_path: "payloads/beale_2D_hygo.json.zst",
        },
        scenarioRow,
      ],
    } as unknown as RunDetailResponse;
    rerender(
      <RunDetail detail={swapped} onChanged={() => {}} onDeleted={() => {}} />,
    );
    expect(await screen.findByTestId("chart-skeleton")).toBeInTheDocument();

    refetch.resolve({});
    await waitFor(() => {
      expect(screen.queryByTestId("chart-skeleton")).toBeNull();
    });
  });
});
