import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import ResultsView from "./ResultsView";
import type { RunDetailResponse, RunRow } from "@/lib/schemas";

const runRow: RunRow = {
  id: "abc",
  label: "test run",
  status: "completed",
  created_at: "2026-08-29T00:00:00",
  duration_s: 10,
  output_dir: "/tmp/run",
  n_runs: 5,
  max_evals: 50_000,
  alpha: 0.05,
  scenarios: 20,
  tags: [],
};

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
  scenario_results: [
    {
      fname: "booth",
      dim: 2,
      algo_key: "hygo",
      payloads_path: "/tmp/run/p.json.zst",
      converged_all: false,
      conv_pct: 0,
      mean_best: 1,
      median_best: 1,
      std_best: null,
      min_best: 1,
      max_best: 1,
      iqr_best: 0,
      cv: null,
      mean_obj_error: 1,
      std_obj_error: null,
      mean_conv_gen: null,
      mean_auc: -1,
      std_auc: null,
      mean_evals: 1000,
      mean_wall_ms: 10,
      median_wall_ms: 10,
      evals_per_ms: 100,
    },
  ],
  tags: [],
} as unknown as RunDetailResponse;

vi.mock("@/lib/api", () => ({
  pyInvokeValidated: vi.fn((cmd: string) => {
    if (cmd === "list_runs")
      return Promise.resolve({
        items: [runRow],
        total: 1,
        page: 1,
        per_page: 100,
      });
    if (cmd === "get_run_detail") return Promise.resolve(detail);
    return Promise.reject(new Error("no analysis"));
  }),
  subscribeValidated: vi.fn(() => Promise.resolve(() => undefined)),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  revealItemInDir: vi.fn(),
  openPath: vi.fn(),
}));

describe("ResultsView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the completed run metrics", async () => {
    render(
      <MemoryRouter>
        <ResultsView />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByText("test run")).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByText(/booth 2D/)).toBeInTheDocument();
    });
  });
});
