import { useMemo } from "react";
import type { EChartsOption } from "@/lib/echarts";
import { EchartsHost } from "@/components/charts/EchartsHost";
import {
  ALGO_COLORS,
  ALGO_KEYS,
  ALGO_LABELS,
  type AlgoKey,
  type AnalysisSummary,
  type ScenarioResultRow,
} from "@/lib/schemas";

const AXIS_TEXT = "#a1a1aa";
const SPLIT_LINE = "#27272a";
const CI_BETTER = "#34d399";
const CI_WORSE = "#f87171";
const TIE_COLOR = "#a1a1aa";

const HYDE_KEYS: AlgoKey[] = ["hyde_bin", "hyde_qub", "hyde_con"];

const axisLabel = { color: AXIS_TEXT, fontSize: 10 };
const splitLine = { lineStyle: { color: SPLIT_LINE } };

/** Compact tick labels for value axes whose min/max are set from data
 * (otherwise echarts prints raw floats like -149.68170403732656). */
function formatTick(v: number): string {
  if (v === 0) return "0";
  const abs = Math.abs(v);
  if (abs >= 1e5 || abs < 1e-2) return v.toExponential(0);
  if (abs >= 100) return v.toFixed(0);
  if (abs >= 1) return v.toFixed(1);
  return v.toPrecision(2);
}

/**
 * Narrow view of the custom-series render API actually used below. The
 * echarts typings mark these hooks optional/loose, which fights inference;
 * a local narrow type keeps the render functions readable.
 */
interface ChartRenderApi {
  value(dim: number): number;
  coord(point: number[]): number[];
  size(size: number[]): number[];
}

/** Scenario keys in first-appearance order (`<fname>_<dim>D`). */
function scenarioKeys(rows: ScenarioResultRow[]): string[] {
  return Array.from(new Set(rows.map((r) => `${r.fname}_${r.dim}D`)));
}

function rowFor(
  rows: ScenarioResultRow[],
  ak: AlgoKey,
  key: string,
): ScenarioResultRow | undefined {
  return rows.find((r) => r.algo_key === ak && `${r.fname}_${r.dim}D` === key);
}

function mean(values: number[]): number {
  return values.length > 0
    ? values.reduce((a, b) => a + b, 0) / values.length
    : NaN;
}

function std(values: number[]): number {
  if (values.length === 0) return NaN;
  const m = mean(values);
  return Math.sqrt(
    values.reduce((s, v) => s + (v - m) * (v - m), 0) / values.length,
  );
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function Figure({
  testId,
  caption,
  option,
  height = 280,
}: {
  testId: string;
  caption: string;
  option: EChartsOption;
  height?: number;
}) {
  return (
    <figure data-testid={testId} className="space-y-1">
      <figcaption className="text-xs italic text-muted-foreground">
        {caption}
      </figcaption>
      <EchartsHost option={option} height={height} />
    </figure>
  );
}

/** (a) Wins per algorithm across scenarios, mirroring qa_objective_error_wins.png. */
export function ObjectiveErrorWinsFigure({
  kruskal,
}: {
  kruskal: AnalysisSummary["kruskal_per_scenario"];
}) {
  const option = useMemo<EChartsOption>(() => {
    const wins = new Map<AlgoKey, number>(ALGO_KEYS.map((k) => [k, 0]));
    for (const kr of kruskal) {
      const best = kr.best_algo as AlgoKey;
      if (wins.has(best)) wins.set(best, (wins.get(best) ?? 0) + 1);
    }
    return {
      animation: false,
      backgroundColor: "transparent",
      tooltip: { trigger: "axis" },
      grid: { left: 56, right: 16, top: 24, bottom: 32 },
      xAxis: {
        type: "category",
        data: ALGO_KEYS.map((k) => ALGO_LABELS[k]),
        axisLabel,
      },
      yAxis: { type: "value", axisLabel, splitLine },
      series: [
        {
          type: "bar",
          data: ALGO_KEYS.map((k) => ({
            value: wins.get(k) ?? 0,
            itemStyle: { color: ALGO_COLORS[k] },
          })),
          label: { show: true, position: "top", color: AXIS_TEXT },
        },
      ],
    };
  }, [kruskal]);
  return (
    <Figure
      testId="fig-a-wins"
      caption="Best algorithm per scenario - wins by mean objective error"
      option={option}
      height={240}
    />
  );
}

/** (b) Grouped convergence bars per scenario, mirroring qb_convergence_rate.png. */
export function ConvergenceRateFigure({
  scenarioResults,
}: {
  scenarioResults: ScenarioResultRow[];
}) {
  const option = useMemo<EChartsOption>(() => {
    const keys = scenarioKeys(scenarioResults);
    return {
      animation: false,
      backgroundColor: "transparent",
      tooltip: { trigger: "axis" },
      legend: { textStyle: { color: AXIS_TEXT }, top: 0 },
      grid: { left: 72, right: 16, top: 28, bottom: 56 },
      xAxis: {
        type: "category",
        data: keys.map((k) => k.replace("_", "\n")),
        axisLabel: { ...axisLabel, interval: 0, rotate: 30 },
      },
      yAxis: { type: "value", axisLabel, splitLine },
      series: ALGO_KEYS.map((ak) => ({
        name: ALGO_LABELS[ak],
        type: "bar" as const,
        data: keys.map(
          (k) => rowFor(scenarioResults, ak, k)?.mean_wall_ms ?? null,
        ),
        itemStyle: { color: ALGO_COLORS[ak] },
      })),
    };
  }, [scenarioResults]);
  return (
    <Figure
      testId="fig-b-conv"
      caption="Convergence rate - percentage of runs that converged per benchmark"
      option={option}
      height={280}
    />
  );
}

/** (c) Mean wall time per algorithm across benchmarks, with std whiskers. */
export function WallTimeSummaryFigure({
  scenarioResults,
}: {
  scenarioResults: ScenarioResultRow[];
}) {
  const option = useMemo<EChartsOption>(() => {
    const keys = scenarioKeys(scenarioResults);
    const means: number[] = [];
    const stds: number[] = [];
    for (const ak of ALGO_KEYS) {
      const vals = keys
        .map((k) => rowFor(scenarioResults, ak, k)?.mean_wall_ms ?? null)
        .filter((v): v is number => v !== null && Number.isFinite(v));
      means.push(Number.isFinite(mean(vals)) ? mean(vals) : 0);
      stds.push(Number.isFinite(std(vals)) ? std(vals) : 0);
    }
    return {
      animation: false,
      backgroundColor: "transparent",
      tooltip: {
        trigger: "axis",
        valueFormatter: (v) =>
          typeof v === "number" ? `${v.toFixed(0)} ms` : String(v),
      },
      grid: { left: 72, right: 16, top: 24, bottom: 32 },
      xAxis: {
        type: "category",
        data: ALGO_KEYS.map((k) => ALGO_LABELS[k]),
        axisLabel,
      },
      yAxis: { type: "value", axisLabel, splitLine },
      series: [
        {
          type: "bar",
          data: ALGO_KEYS.map((ak, i) => ({
            value: means[i],
            itemStyle: { color: ALGO_COLORS[ak] },
          })),
          label: {
            show: true,
            position: "top",
            color: AXIS_TEXT,
            formatter: (p) =>
              `${Number((p as { value: unknown }).value).toFixed(0)}ms`,
          },
        },
        {
          type: "custom",
          renderItem: (_params, api) => {
            const a = api as unknown as ChartRenderApi;
            const idx = a.value(0);
            const center = a.coord([idx, means[idx]]);
            const lo = a.coord([idx, means[idx] - stds[idx]]);
            const hi = a.coord([idx, means[idx] + stds[idx]]);
            const cap = a.size([1, 0])[0] * 0.1;
            const stroke = { stroke: AXIS_TEXT, lineWidth: 1 };
            return {
              type: "group",
              children: [
                {
                  type: "line",
                  shape: { x1: center[0], y1: hi[1], x2: center[0], y2: lo[1] },
                  style: stroke,
                },
                {
                  type: "line",
                  shape: {
                    x1: center[0] - cap,
                    y1: hi[1],
                    x2: center[0] + cap,
                    y2: hi[1],
                  },
                  style: stroke,
                },
                {
                  type: "line",
                  shape: {
                    x1: center[0] - cap,
                    y1: lo[1],
                    x2: center[0] + cap,
                    y2: lo[1],
                  },
                  style: stroke,
                },
              ],
            };
          },
          data: means.map((m, i) => [i, m]),
          z: 10,
        },
      ],
    };
  }, [scenarioResults]);
  return (
    <Figure
      testId="fig-c-summary"
      caption="Computational cost - mean wall-clock time across all benchmarks (whiskers: +/-1 std)"
      option={option}
      height={260}
    />
  );
}

/** (c) Grouped wall-time bars per scenario, mirroring qc_wall_time_per_benchmark.png. */
export function WallTimePerBenchmarkFigure({
  scenarioResults,
}: {
  scenarioResults: ScenarioResultRow[];
}) {
  const option = useMemo<EChartsOption>(() => {
    const keys = scenarioKeys(scenarioResults);
    return {
      animation: false,
      backgroundColor: "transparent",
      tooltip: {
        trigger: "axis",
        valueFormatter: (v) =>
          typeof v === "number" ? `${v.toFixed(0)} ms` : String(v),
      },
      legend: { textStyle: { color: AXIS_TEXT }, top: 0 },
      grid: { left: 72, right: 16, top: 28, bottom: 32 },
      xAxis: {
        type: "category",
        data: keys.map((k) => k.replace("_", "\n")),
        axisLabel,
      },
      yAxis: { type: "value", axisLabel, splitLine },
      series: ALGO_KEYS.map((ak) => ({
        name: ALGO_LABELS[ak],
        type: "bar" as const,
        data: keys.map(
          (k) => rowFor(scenarioResults, ak, k)?.mean_wall_ms ?? null,
        ),
        itemStyle: { color: ALGO_COLORS[ak] },
      })),
    };
  }, [scenarioResults]);
  return (
    <Figure
      testId="fig-c-per-benchmark"
      caption="Computational cost - mean wall-clock time per benchmark"
      option={option}
      height={300}
    />
  );
}

/** (d) Significant win counts, mirroring qd_margin_wins.png. */
export function MarginWinsFigure({
  margins,
}: {
  margins: AnalysisSummary["margin_vs_hygo"];
}) {
  const option = useMemo<EChartsOption>(() => {
    const wins = new Map<AlgoKey, number>(HYDE_KEYS.map((k) => [k, 0]));
    wins.set("hygo", 0);
    let ties = 0;
    for (const m of margins) {
      if (!m.sig) {
        ties += 1;
      } else if ((m.direction ?? "").includes("HyGO better")) {
        wins.set("hygo", (wins.get("hygo") ?? 0) + 1);
      } else if (wins.has(m.hyde_key as AlgoKey)) {
        wins.set(
          m.hyde_key as AlgoKey,
          (wins.get(m.hyde_key as AlgoKey) ?? 0) + 1,
        );
      }
    }
    const labels: AlgoKey[] = [...HYDE_KEYS, "hygo"];
    return {
      animation: false,
      backgroundColor: "transparent",
      tooltip: { trigger: "axis" },
      grid: { left: 56, right: 16, top: 24, bottom: 32 },
      xAxis: {
        type: "category",
        data: [...labels.map((k) => ALGO_LABELS[k]), "No sig. diff."],
        axisLabel,
      },
      yAxis: { type: "value", axisLabel, splitLine },
      series: [
        {
          type: "bar",
          data: [
            ...labels.map((k) => ({
              value: wins.get(k) ?? 0,
              itemStyle: { color: ALGO_COLORS[k] },
            })),
            { value: ties, itemStyle: { color: SPLIT_LINE } },
          ],
          label: { show: true, position: "top", color: AXIS_TEXT },
        },
      ],
    };
  }, [margins]);
  return (
    <Figure
      testId="fig-d-wins"
      caption="HyDE vs HyGO - Wilcoxon significant wins per variant (ties: no significant difference)"
      option={option}
      height={240}
    />
  );
}

/**
 * (d) Bootstrap 95% CI forest plot for one variant, mirroring
 * qd_bootstrap_ci_<hk>.png: interval entirely above zero (HyGO better) red,
 * entirely below zero (HyDE better) green, spanning zero neutral.
 */
export function BootstrapCiFigure({
  margins,
  hydeKey,
}: {
  margins: AnalysisSummary["margin_vs_hygo"];
  hydeKey: AlgoKey;
}) {
  const rows = useMemo(
    () =>
      margins
        .filter((m) => m.hyde_key === hydeKey)
        .map((m) => ({
          key: m.key,
          mean: m.mean_diff,
          lo: m.bootstrap_ci_lo,
          hi: m.bootstrap_ci_hi,
        }))
        .filter(
          (r) =>
            r.mean !== null &&
            r.lo !== null &&
            r.hi !== null &&
            Number.isFinite(r.mean) &&
            Number.isFinite(r.lo) &&
            Number.isFinite(r.hi),
        ),
    [margins, hydeKey],
  );
  const option = useMemo<EChartsOption>(() => {
    const los = rows.map((r) => r.lo as number);
    const his = rows.map((r) => r.hi as number);
    // auto-scale would only see the [mean, 0] data items; pin the axis to
    // the full CI range plus padding so the intervals stay readable
    const lo = Math.min(0, ...los);
    const hi = Math.max(0, ...his);
    const pad = (hi - lo || 1) * 0.08;
    return {
      animation: false,
      backgroundColor: "transparent",
      tooltip: {
        trigger: "item",
        formatter: (p) => {
          const r = rows[(p as { dataIndex?: number }).dataIndex ?? -1];
          if (!r) return "";
          return `${r.key}<br/>mean diff ${(r.mean as number).toExponential(2)}<br/>95% CI [${(r.lo as number).toExponential(2)}, ${(r.hi as number).toExponential(2)}]`;
        },
      },
      grid: { left: 120, right: 24, top: 16, bottom: 40 },
      xAxis: {
        type: "value",
        min: lo - pad,
        max: hi + pad,
        axisLabel: {
          ...axisLabel,
          formatter: (v: number) => formatTick(v),
        },
        splitLine,
      },
      yAxis: {
        type: "category",
        data: rows.map((r) => r.key),
        axisLabel: { color: AXIS_TEXT, fontSize: 9 },
      },
      series: [
        {
          type: "custom",
          renderItem: (params, api) => {
            const a = api as unknown as ChartRenderApi;
            const idx = params.dataIndex;
            const r = rows[idx];
            if (!r) return { type: "group", children: [] };
            const ciLo = r.lo as number;
            const ciHi = r.hi as number;
            const mid = r.mean as number;
            const xZero = a.coord([0, idx])[0];
            const y = a.coord([0, idx])[1];
            const xLo = a.coord([ciLo, idx])[0];
            const xHi = a.coord([ciHi, idx])[0];
            const xMid = a.coord([mid, idx])[0];
            const barH = a.size([0, 1])[1] * 0.6;
            const capH = barH * 0.45;
            // same coloring rule as the report's forest plot: green when the
            // whole CI is below zero (HyDE better), red when above (HyGO
            // better), otherwise neutral
            const color =
              ciLo > 0 ? CI_WORSE : ciHi < 0 ? CI_BETTER : TIE_COLOR;
            return {
              type: "group",
              children: [
                {
                  // bar from zero to the mean (the report's ax.barh bar)
                  type: "rect",
                  shape: {
                    x: Math.min(xZero, xMid),
                    y: y - barH / 2,
                    width: Math.max(Math.abs(xMid - xZero), 1),
                    height: barH,
                  },
                  style: { fill: color, opacity: 0.7 },
                },
                {
                  // error whisker across the 95% CI with end caps
                  type: "line",
                  shape: { x1: xLo, y1: y, x2: xHi, y2: y },
                  style: { stroke: color, lineWidth: 1.2 },
                },
                {
                  type: "line",
                  shape: {
                    x1: xLo,
                    y1: y - capH / 2,
                    x2: xLo,
                    y2: y + capH / 2,
                  },
                  style: { stroke: color, lineWidth: 1.2 },
                },
                {
                  type: "line",
                  shape: {
                    x1: xHi,
                    y1: y - capH / 2,
                    x2: xHi,
                    y2: y + capH / 2,
                  },
                  style: { stroke: color, lineWidth: 1.2 },
                },
              ],
            };
          },
          data: rows.map((r) => [r.mean as number, 0]),
        },
        {
          type: "line" as const,
          markLine: {
            silent: true,
            symbol: "none",
            data: [{ xAxis: 0 }],
            lineStyle: { color: AXIS_TEXT, type: "dashed" },
            label: { show: false },
          },
          data: [],
        },
      ],
    };
  }, [rows]);
  return (
    <Figure
      testId={`fig-d-ci-${hydeKey}`}
      caption={`${ALGO_LABELS[hydeKey]} vs HyGO - bootstrap 95% CI on the mean difference (HyDE - HyGO)`}
      option={option}
      height={Math.max(200, rows.length * 28 + 60)}
    />
  );
}
/** (e) Grouped CV-at-25D bars, mirroring qe_cv_25d.png. */
export function Cv25dFigure({
  scaling,
}: {
  scaling: AnalysisSummary["scaling"];
}) {
  const option = useMemo<EChartsOption>(() => {
    const fnames = Array.from(new Set(scaling.map((r) => r.fname)));
    return {
      animation: false,
      backgroundColor: "transparent",
      tooltip: { trigger: "axis" },
      legend: { textStyle: { color: AXIS_TEXT }, top: 0 },
      grid: { left: 72, right: 16, top: 28, bottom: 48 },
      xAxis: {
        type: "category",
        data: fnames.map((f) => f.replace("_", "\n")),
        axisLabel: { ...axisLabel, interval: 0, rotate: 30 },
      },
      yAxis: { type: "value", axisLabel, splitLine },
      series: ALGO_KEYS.map((ak) => ({
        name: ALGO_LABELS[ak],
        type: "bar" as const,
        data: fnames.map(
          (f) =>
            scaling.find((r) => r.fname === f && r.algo_key === ak)?.cv_25d ??
            null,
        ),
        itemStyle: { color: ALGO_COLORS[ak] },
      })),
    };
  }, [scaling]);
  return (
    <Figure
      testId="fig-e-cv"
      caption="Result consistency at 25D - coefficient of variation per benchmark"
      option={option}
      height={280}
    />
  );
}

/** (e) Normalized-degradation heatmap, mirroring qe_degradation_heatmap.png. */
export function DegradationHeatmapFigure({
  scaling,
}: {
  scaling: AnalysisSummary["scaling"];
}) {
  const option = useMemo<EChartsOption>(() => {
    const fnames = Array.from(new Set(scaling.map((r) => r.fname)));
    const ratioFor = (f: string, ak: AlgoKey): number | null =>
      scaling.find((r) => r.fname === f && r.algo_key === ak)
        ?.degradation_ratio ?? null;
    const finiteRatios = scaling
      .map((r) => r.degradation_ratio)
      .filter((v): v is number => v !== null && Number.isFinite(v));
    const clipMax =
      finiteRatios.length > 0 ? percentile(finiteRatios, 0.95) * 1.2 : 10;
    const colorMax = Math.max(clipMax, 1);
    // Like the report's np.clip: every cell gets a color, with infinite
    // ratios (null over IPC) mapped to the top of the scale instead of
    // rendering as missing cells.
    const displayRatio = (v: number | null): number =>
      v === null || !Number.isFinite(v) ? colorMax : Math.min(v, colorMax);
    const ratioLabel = (v: number | null): string => {
      if (v === null || !Number.isFinite(v)) return "n/a";
      return Math.abs(v) < 1e6 ? v.toFixed(1) : v.toExponential(1);
    };
    const data = fnames.flatMap((f, j) =>
      ALGO_KEYS.map((ak, i) => {
        const raw = ratioFor(f, ak);
        const shown = displayRatio(raw);
        return {
          value: [j, i, shown],
          ratio: raw,
          label: {
            // same text-contrast rule as the report: white on hot cells,
            // black on pale ones
            color: shown > colorMax * 0.6 ? "#ffffff" : "#000000",
          },
        };
      }),
    );
    return {
      animation: false,
      backgroundColor: "transparent",
      tooltip: {
        formatter: (p) => {
          const item = (
            p as unknown as {
              data: { value: [number, number]; ratio: number | null };
            }
          ).data;
          const [j, i] = item.value;
          return `${fnames[j]} / ${ALGO_LABELS[ALGO_KEYS[i]]}: ${ratioLabel(item.ratio)}`;
        },
      },
      visualMap: {
        min: 0,
        max: colorMax,
        calculable: false,
        orient: "horizontal",
        left: "center",
        bottom: 0,
        textStyle: { color: AXIS_TEXT },
        inRange: {
          color: ["#ffffcc", "#ffeda0", "#feb24c", "#fc4e2a", "#bd0026"],
        },
      },
      grid: { left: 120, right: 24, top: 16, bottom: 56 },
      xAxis: {
        type: "category",
        data: fnames.map((f) => f.replace("_", "\n")),
        axisLabel: { ...axisLabel, interval: 0, rotate: 30 },
        splitLine: { show: false },
      },
      yAxis: {
        type: "category",
        // report's imshow puts the first algorithm on top
        data: ALGO_KEYS.map((k) => ALGO_LABELS[k]),
        inverse: true,
        axisLabel,
        splitLine: { show: false },
      },
      series: [
        {
          type: "heatmap",
          data,
          itemStyle: {
            borderColor: SPLIT_LINE,
            borderWidth: 1,
          },
          label: {
            show: true,
            fontSize: 9,
            formatter: (p) => {
              const d = (p as unknown as { data: { ratio: number | null } })
                .data;
              return ratioLabel(d.ratio);
            },
          },
        },
      ],
    };
  }, [scaling]);
  return (
    <Figure
      testId="fig-e-heatmap"
      caption="Normalized degradation 2D to 25D - (mean 25D - mean 2D) / max(mean 2D, 1e-12); lower means it scales better"
      option={option}
      height={Math.max(220, ALGO_KEYS.length * 44)}
    />
  );
}
