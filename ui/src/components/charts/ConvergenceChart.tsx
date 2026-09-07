import { useEffect, useRef } from "react";
import * as echarts from "echarts";
import { ALGO_COLORS, ALGO_KEYS, ALGO_LABELS } from "@/lib/schemas";

/** Coalescing window: echarts updates at most once per window. */
export const CHART_FLUSH_MS = 100;

interface ConvergenceChartProps {
  /** algo_key -> best-so-far curve */
  curves: Record<string, number[]>;
  height?: number;
}

function buildOption(curves: Record<string, number[]>) {
  const series = ALGO_KEYS.filter((k) => (curves[k]?.length ?? 0) > 0).map(
    (algo) => ({
      name: ALGO_LABELS[algo],
      type: "line" as const,
      showSymbol: false,
      data: curves[algo],
      lineStyle: { width: 1.5, color: ALGO_COLORS[algo] },
      itemStyle: { color: ALGO_COLORS[algo] },
    }),
  );

  const maxLen = Math.max(0, ...series.map((s) => s.data.length));

  return {
    animation: false,
    backgroundColor: "transparent",
    grid: { left: 56, right: 16, top: 32, bottom: 32 },
    legend: {
      top: 0,
      textStyle: { color: "#a1a1aa" },
      itemWidth: 14,
    },
    tooltip: {
      trigger: "axis",
      valueFormatter: (v: number) => v.toExponential(3),
    },
    xAxis: {
      type: "category",
      name: "gen",
      nameTextStyle: { color: "#a1a1aa" },
      axisLabel: { color: "#a1a1aa" },
      data: maxLen > 0 ? Array.from({ length: maxLen }, (_, i) => i) : [],
    },
    yAxis: {
      type: "log",
      name: "best cost",
      nameTextStyle: { color: "#a1a1aa" },
      axisLabel: {
        color: "#a1a1aa",
        formatter: (v: number) => v.toExponential(0),
      },
      splitLine: { lineStyle: { color: "#27272a" } },
    },
    series,
  };
}

/** Log-scale best-so-far convergence chart for the active scenario. */
export default function ConvergenceChart({
  curves,
  height = 320,
}: ConvergenceChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  // Telemetry can arrive in bursts (up to 4 algos x emitter rate); coalesce
  // them so echarts redraws at most once per CHART_FLUSH_MS.
  const pendingRef = useRef<Record<string, number[]> | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = echarts.init(containerRef.current);
    chartRef.current = chart;
    const onResize = () => chart.resize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = null;
      pendingRef.current = null;
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    pendingRef.current = curves;
    if (timerRef.current !== null) return; // flush already scheduled
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      const pending = pendingRef.current;
      if (!pending) return;
      pendingRef.current = null;
      chartRef.current?.setOption(buildOption(pending), {
        notMerge: false,
        lazyUpdate: true,
      });
    }, CHART_FLUSH_MS);
  }, [curves]);

  return <div ref={containerRef} style={{ width: "100%", height }} />;
}
