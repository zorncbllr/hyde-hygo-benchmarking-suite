import { useEffect, useRef } from "react";
import * as echarts from "echarts";
import { ALGO_COLORS, ALGO_KEYS, ALGO_LABELS } from "@/lib/schemas";

interface ConvergenceChartProps {
  /** algo_key -> best-so-far curve */
  curves: Record<string, number[]>;
  height?: number;
}

/** Log-scale best-so-far convergence chart for the active scenario. */
export default function ConvergenceChart({
  curves,
  height = 320,
}: ConvergenceChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = echarts.init(containerRef.current);
    chartRef.current = chart;
    const onResize = () => chart.resize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

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

    chart.setOption(
      {
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
      },
      { notMerge: false },
    );
  }, [curves]);

  return <div ref={containerRef} style={{ width: "100%", height }} />;
}
