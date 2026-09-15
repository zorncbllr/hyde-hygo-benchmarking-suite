import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import RunDetail from "./RunDetail";
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
  useSurface: () => ({ surface: null, error: null }),
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
