import * as echarts from "echarts/core";
import { BoxplotChart, LineChart } from "echarts/charts";
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

/**
 * Shared, tree-shaken echarts instance. Registering only the pieces the app
 * uses (line, boxplot, grid/tooltip/legend, canvas renderer) keeps the full
 * echarts bundle out of the WebView, which cuts startup cost and memory
 * footprint. All chart hosts must import echarts from this module.
 */
echarts.use([
  BoxplotChart,
  LineChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  CanvasRenderer,
]);

export default echarts;

/** Convenience alias for chart instances returned by init(). */
export type ECharts = ReturnType<typeof echarts.init>;

export type { EChartsOption } from "echarts";
