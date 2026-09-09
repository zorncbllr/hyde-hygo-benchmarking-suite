import { useEffect, useRef } from "react";
import echarts from "@/lib/echarts";
import type { SimFrame } from "@/lib/simulation";
import { ALGO_COLORS, ALGO_LABELS, type AlgoKey } from "@/lib/schemas";

interface SimConvergenceChartProps {
  algoKey: AlgoKey;
  frame: SimFrame;
  maxEvals: number;
  height?: number;
}

/**
 * Best-so-far curve of the simulated run up to the current step (log scale),
 * x = evaluation count. Follows the replayed state live.
 */
export default function SimConvergenceChart({
  algoKey,
  frame,
  maxEvals,
  height = 150,
}: SimConvergenceChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  // Tracks the static option shape (axes, scales, styling) so playback steps
  // can skip rebuilding it.
  const staticKeyRef = useRef<string | null>(null);

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
    const color = ALGO_COLORS[algoKey];
    const data = frame.evalCurve.map((p) => [p.e, p.c]);
    const staticKey = `${algoKey}|${maxEvals}`;
    const staticChanged = staticKeyRef.current !== staticKey;
    staticKeyRef.current = staticKey;
    if (staticChanged) {
      chart.setOption(
        {
          animation: false,
          backgroundColor: "transparent",
          grid: { left: 56, right: 12, top: 24, bottom: 26 },
          tooltip: {
            trigger: "axis",
            valueFormatter: (v: number) => v.toExponential(3),
          },
          xAxis: {
            type: "value",
            name: "evals",
            nameTextStyle: { color: "#a1a1aa" },
            axisLabel: { color: "#a1a1aa" },
            splitLine: { lineStyle: { color: "#27272a" } },
            max: maxEvals,
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
          series: [
            {
              name: ALGO_LABELS[algoKey],
              type: "line",
              showSymbol: false,
              data,
              lineStyle: { width: 1.5, color },
              itemStyle: { color },
            },
          ],
        },
        { notMerge: true, lazyUpdate: true },
      );
    } else {
      // Playback step: only the series data changed. A merge update avoids
      // rebuilding the entire chart model at up to ~22 steps/s (8x speed).
      chart.setOption({ series: [{ data }] }, { lazyUpdate: true });
    }
  }, [algoKey, maxEvals, frame.evalCurve]);

  return <div ref={containerRef} style={{ width: "100%", height }} />;
}
