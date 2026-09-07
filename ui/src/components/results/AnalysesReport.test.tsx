import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AnalysesReport } from "./AnalysesReport";
import {
  analysisSummaryResponseSchema,
  type AnalysisSummary,
  type ScenarioResultRow,
} from "@/lib/schemas";

function makeScenarioRows(): ScenarioResultRow[] {
  const base = {
    converged_all: false,
    mean_best: 1.0,
    median_best: 1.0,
    std_best: 0.1,
    min_best: 0.9,
    max_best: 1.1,
    iqr_best: 0.1,
    cv: 0.1,
    mean_obj_error: 1.0,
    std_obj_error: 0.1,
    mean_conv_gen: 5,
    mean_auc: 10,
    std_auc: 1,
    mean_evals: 100,
    mean_wall_ms: 20,
    median_wall_ms: 20,
    evals_per_ms: 50,
    payloads_path: "p.zst",
  };
  return [
    { fname: "booth", dim: 2, algo_key: "hyde_bin", conv_pct: 100, ...base },
    { fname: "booth", dim: 2, algo_key: "hyde_qub", conv_pct: 100, ...base },
    { fname: "booth", dim: 2, algo_key: "hyde_con", conv_pct: 50, ...base },
    { fname: "booth", dim: 2, algo_key: "hygo", conv_pct: 0, ...base },
  ];
}

function makeAnalysis(): AnalysisSummary {
  const parsed = analysisSummaryResponseSchema.parse({
    friedman_objective_error: {
      chi2: 12.34,
      p_friedman: 0.006,
      sig: true,
      mean_ranks: { hyde_bin: 1.5, hyde_qub: 2.5, hyde_con: 3.5, hygo: 2.0 },
      best_algo: "hyde_bin",
      critical_diff: 1.0,
      n_benchmarks: 1,
      nemenyi: [
        {
          pair: "HyDE-bin vs HyGO",
          mean_rank_i: 1.5,
          mean_rank_j: 2.0,
          rank_diff: 0.5,
          critical_diff: 1.0,
          significant: false,
          direction: "HyDE-bin better",
        },
      ],
    },
    kruskal_per_scenario: [
      {
        key: "booth_2D",
        h_stat: 7.2,
        p_kruskal: 0.06,
        sig: false,
        best_algo: "hyde_bin",
      },
    ],
    cochrans_q: { Q_stat: 4.0, p_value: 0.26, sig: false },
    chi2_convergence: [
      {
        key: "booth_2D",
        chi2: 6.0,
        p_value: 0.11,
        sig: false,
        conv_counts: { hyde_bin: 2, hyde_qub: 2, hyde_con: 1, hygo: 0 },
      },
    ],
    friedman_wall_time: {
      chi2: 5.1,
      p_friedman: 0.16,
      sig: false,
      mean_ranks: { hyde_bin: 2.0, hyde_qub: 2.0, hyde_con: 2.0, hygo: 2.0 },
      grand_means_ms: { hyde_bin: 10, hyde_qub: 11, hyde_con: 12, hygo: 20 },
      speedup_vs_hygo: {
        hyde_bin: 2.0,
        hyde_qub: 1.8,
        hyde_con: 1.67,
        hygo: 1.0,
      },
      fastest: "hyde_bin",
    },
    wall_time_kruskal: [],
    margin_vs_hygo: [
      {
        key: "booth_2D",
        hyde_key: "hyde_bin",
        hyde_label: "HyDE-bin",
        u_stat: 3,
        p_value: 0.5,
        sig: false,
        hyde_mean: 1.0,
        hygo_mean: 2.0,
        mean_diff: -1.0,
        cliffs_delta: -0.5,
        d_magnitude: "large",
        bootstrap_ci_lo: -2e-3,
        bootstrap_ci_hi: 1e-4,
        direction: "HyDE-bin better",
      },
    ],
    scaling: [
      {
        fname: "sphere",
        algo_key: "hyde_bin",
        algo_label: "HyDE-bin",
        u_stat: 4,
        p_value: 0.01,
        sig: true,
        mean_2d: 1,
        mean_25d: 100,
        cv_2d: 0.01,
        cv_25d: 0.02,
        cliffs_delta: 0.9,
        d_magnitude: "large",
        degradation_ratio: 100,
        direction: "degraded",
      },
    ],
  });
  return parsed;
}

describe("AnalysesReport", () => {
  it("renders the DOCX report sections (a) through (e)", () => {
    render(
      <AnalysesReport
        analysis={makeAnalysis()}
        scenarioResults={makeScenarioRows()}
        nRuns={2}
      />,
    );
    expect(
      screen.getByText("(a) Mean Final Objective Error"),
    ).toBeInTheDocument();
    expect(screen.getByText("(b) Convergence Rate")).toBeInTheDocument();
    expect(screen.getByText("(c) Wall-Clock Cost per Run")).toBeInTheDocument();
    expect(
      screen.getByText("(d) Practically Meaningful Margin vs HyGO"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("(e) Dimensionality Scaling: 2D vs 25D"),
    ).toBeInTheDocument();
  });

  it("narrative (a) reports the Friedman outcome like the exported report", () => {
    render(
      <AnalysesReport
        analysis={makeAnalysis()}
        scenarioResults={makeScenarioRows()}
        nRuns={2}
      />,
    );
    const narrative = screen.getByText(
      /The Friedman test \(block design, 1 benchmarks\)/,
    );
    expect(narrative.textContent).toContain("yielded \u03c7\u00b2 = 12.34");
    expect(narrative.textContent).toContain(
      "HyDE-bin achieved the lowest mean rank (1.50)",
    );
    expect(narrative.textContent).toContain("significant");
  });

  it("narrative (b) reports Cochran's Q and the best mean convergence", () => {
    render(
      <AnalysesReport
        analysis={makeAnalysis()}
        scenarioResults={makeScenarioRows()}
        nRuns={2}
      />,
    );
    const narrative = screen.getByText(/Cochran\u2019s Q test yielded/);
    expect(narrative.textContent).toContain("Q = 4.00");
    // mean conv = (100+100+50+0)/4 per algo rows... per algo: hyde_bin=100
    expect(narrative.textContent).toContain(
      "HyDE-bin achieved the highest mean convergence rate (100.0%)",
    );
  });

  it("convergence counts table shows converged runs out of n_runs", () => {
    render(
      <AnalysesReport
        analysis={makeAnalysis()}
        scenarioResults={makeScenarioRows()}
        nRuns={2}
      />,
    );
    expect(screen.getAllByText("2/2").length).toBe(2); // hyde_bin, hyde_qub
    expect(screen.getByText("1/2")).toBeInTheDocument(); // hyde_con
    expect(screen.getByText("0/2")).toBeInTheDocument(); // hygo
  });

  it("wall-clock table mirrors the report speedup summary", () => {
    render(
      <AnalysesReport
        analysis={makeAnalysis()}
        scenarioResults={makeScenarioRows()}
        nRuns={2}
      />,
    );
    expect(screen.getByText("Grand Mean (ms)")).toBeInTheDocument();
    expect(screen.getByText("Speedup vs HyGO")).toBeInTheDocument();
  });

  it("renders the infinite degradation ratio as inf", () => {
    const analysis = makeAnalysis();
    analysis.scaling = [
      {
        ...analysis.scaling[0],
        degradation_ratio: null,
      },
    ];
    render(
      <AnalysesReport
        analysis={analysis}
        scenarioResults={makeScenarioRows()}
        nRuns={2}
      />,
    );
    expect(screen.getByText("inf")).toBeInTheDocument();
  });
});
