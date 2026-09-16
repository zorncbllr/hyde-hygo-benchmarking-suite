import { useEffect, useRef } from "react";
import echarts, { type EChartsOption } from "@/lib/echarts";

/**
 * Simple echarts host: the instance is created once per mount and option
 * changes are applied as incremental setOption updates instead of tearing
 * down and re-initializing the whole chart (canvas + renderer) on every
 * option identity change. All charts in the app should render through this
 * host so the shared tree-shaken echarts module is reused.
 */
export function EchartsHost({
  option,
  height = 300,
}: {
  option: EChartsOption;
  height?: number;
}) {
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
    // runs after the init effect on mount, so the chart always exists here
    chartRef.current?.setOption(option, { lazyUpdate: true });
  }, [option]);

  return <div ref={containerRef} style={{ width: "100%", height }} />;
}
