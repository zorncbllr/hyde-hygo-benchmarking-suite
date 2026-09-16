import * as echarts from "echarts/core";
import {
  BarChart,
  BoxplotChart,
  CustomChart,
  HeatmapChart,
  LineChart,
} from "echarts/charts";
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
  VisualMapComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

/**
 * Shared, tree-shaken echarts instance. Registering only the pieces the app
 * uses (line, boxplot, bar, custom error-bar series, heatmap,
 * grid/tooltip/legend/visual-map, canvas renderer) keeps the full echarts
 * bundle out of the WebView, which cuts startup cost and memory footprint.
 * All chart hosts must import echarts from this module.
 */
echarts.use([
  BarChart,
  BoxplotChart,
  CustomChart,
  HeatmapChart,
  LineChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  VisualMapComponent,
  CanvasRenderer,
]);

export default echarts;

/** Convenience alias for chart instances returned by init(). */
export type ECharts = ReturnType<typeof echarts.init>;

export type { EChartsOption } from "echarts";
