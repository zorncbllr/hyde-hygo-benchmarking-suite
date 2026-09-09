import { useEffect, useMemo, useRef, useState } from "react";
import echarts, { type EChartsOption } from "@/lib/echarts";
import { toast } from "sonner";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  Copy,
  Download,
  FolderOpen,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ALGO_COLORS,
  ALGO_KEYS,
  ALGO_LABELS,
  analysisSummaryResponseSchema,
  deleteRunsResponseSchema,
  exportDoneEventSchema,
  exportErrorEventSchema,
  exportProgressEventSchema,
  okResponseSchema,
  scenarioPayloadsResponseSchema,
  type AlgoKey,
  type AnalysisSummary,
  type RunDetailResponse,
  type ScenarioPayload,
} from "@/lib/schemas";
import { useSurface } from "@/hooks/useSurface";
import Replay3D from "@/components/scene/Replay3D";
import { AnalysesReport } from "@/components/results/AnalysesReport";
import { pyInvokeValidated, subscribeValidated } from "@/lib/api";
import { formatDuration, formatMs, formatSci } from "@/lib/formatters";

const EXPORT_GROUPS = [
  { id: "csv", label: "CSV data" },
  { id: "charts", label: "Charts" },
  { id: "docx", label: "DOCX report" },
  { id: "json", label: "JSON results" },
] as const;

function quartiles(values: number[]): [number, number, number, number, number] {
  if (values.length === 0) return [0, 0, 0, 0, 0];
  const sorted = [...values].sort((a, b) => a - b);
  const q = (p: number) => {
    const idx = (sorted.length - 1) * p;
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
  };
  return [sorted[0], q(0.25), q(0.5), q(0.75), sorted[sorted.length - 1]];
}

/**
 * Simple echarts host: the instance is created once per mount and option
 * changes are applied as incremental setOption updates instead of tearing
 * down and re-initializing the whole chart (canvas + renderer) on every
 * option identity change.
 */
function Chart({
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

interface RunDetailProps {
  detail: RunDetailResponse;
  /** called after destructive/mutating actions so the list can refresh */
  onChanged: () => void;
  onDeleted: () => void;
}

/** Detail pane for one run: metrics, charts, replay, analyses, exports. */
export default function RunDetail({
  detail,
  onChanged,
  onDeleted,
}: RunDetailProps) {
  const [payloads, setPayloads] = useState<Partial<
    Record<AlgoKey, ScenarioPayload>
  > | null>(null);
  const [scenarioKey, setScenarioKey] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisSummary | null>(null);
  const [replayAlgo, setReplayAlgo] = useState<AlgoKey>("hygo");
  const [replayRun, setReplayRun] = useState(0);

  // actions
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameLabel, setRenameLabel] = useState(detail.label);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // exports
  const [exportGroups, setExportGroups] = useState<string[]>(
    EXPORT_GROUPS.map((g) => g.id),
  );
  const [exportBusy, setExportBusy] = useState(false);
  const [lastArtifacts, setLastArtifacts] = useState<Record<
    string,
    string[]
  > | null>(null);

  useEffect(() => {
    setScenarioKey(
      [
        ...new Set(detail.scenario_results.map((r) => `${r.fname}_${r.dim}D`)),
      ][0] ?? null,
    );
    setRenameLabel(detail.label);
  }, [detail]);

  useEffect(() => {
    pyInvokeValidated("get_analysis", analysisSummaryResponseSchema, {
      run_id: detail.id,
    })
      .then((a: AnalysisSummary) => setAnalysis(a))
      .catch(() => setAnalysis(null));
  }, [detail.id]);

  // Fetch payloads for all four algorithms of the selected scenario in a
  // single batched IPC call (separate invokes would trip the rate limiter).
  useEffect(() => {
    if (!scenarioKey) {
      setPayloads(null);
      return;
    }
    let cancelled = false;
    pyInvokeValidated("get_scenario_payloads", scenarioPayloadsResponseSchema, {
      run_id: detail.id,
      scenario_key: scenarioKey,
    })
      .then((entries) => {
        if (!cancelled) {
          setPayloads(entries as Partial<Record<AlgoKey, ScenarioPayload>>);
        }
      })
      .catch(() => {
        if (!cancelled) setPayloads(null);
      });
    return () => {
      cancelled = true;
    };
  }, [detail, scenarioKey]);

  // export events
  useEffect(() => {
    const unlisteners: Array<Promise<() => void>> = [
      subscribeValidated("export://progress", exportProgressEventSchema, (p) =>
        toast.info(p.message),
      ),
      subscribeValidated("export://done", exportDoneEventSchema, (p) => {
        setLastArtifacts(p.artifacts);
        setExportBusy(false);
        toast.success("Export finished");
      }),
      subscribeValidated("export://error", exportErrorEventSchema, (p) => {
        setExportBusy(false);
        toast.error(`Export failed: ${p.error}`);
      }),
    ];
    return () => {
      unlisteners.forEach((p) => p.then((un) => un()));
    };
  }, []);

  const scenarioKeys = useMemo(
    () =>
      Array.from(
        new Set(detail.scenario_results.map((r) => `${r.fname}_${r.dim}D`)),
      ),
    [detail],
  );

  const replayScenarioKeys = useMemo(
    () => scenarioKeys.filter((k) => /_2D$/.test(k)),
    [scenarioKeys],
  );
  const replayFname = scenarioKey?.replace(/_\d+D$/, "") ?? "ackley";
  const { surface: replaySurface, error: replaySurfaceError } =
    useSurface(replayFname);
  const replayHistory = payloads?.[replayAlgo]?.replay_histories ?? [];

  useEffect(() => {
    const algos = ALGO_KEYS.filter(
      (k) => payloads?.[k]?.replay_histories?.length,
    );
    if (algos.length > 0 && !algos.includes(replayAlgo)) {
      setReplayAlgo(algos[0]);
    }
    const nRuns = payloads?.[replayAlgo]?.replay_histories?.length ?? 0;
    if (replayRun >= nRuns) setReplayRun(0);
  }, [payloads, replayAlgo, replayRun]);

  const convergenceOption = useMemo<EChartsOption>(
    () => ({
      animation: false,
      backgroundColor: "transparent",
      tooltip: { trigger: "axis" },
      legend: { textStyle: { color: "#a1a1aa" } },
      grid: { left: 56, right: 16, top: 32, bottom: 32 },
      xAxis: {
        type: "category",
        data: (payloads?.hygo?.mean_curve ?? []).map((_, i) => i),
        axisLabel: { color: "#a1a1aa" },
      },
      yAxis: {
        type: "log",
        axisLabel: {
          color: "#a1a1aa",
          formatter: (v: number) => v.toExponential(0),
        },
        splitLine: { lineStyle: { color: "#27272a" } },
      },
      series: ALGO_KEYS.map((algo) => ({
        name: ALGO_LABELS[algo],
        type: "line" as const,
        showSymbol: false,
        data: payloads?.[algo]?.mean_curve ?? [],
        lineStyle: { color: ALGO_COLORS[algo] },
        itemStyle: { color: ALGO_COLORS[algo] },
      })),
    }),
    [payloads],
  );

  const boxOption = useMemo<EChartsOption>(
    () => ({
      animation: false,
      backgroundColor: "transparent",
      grid: { left: 56, right: 16, top: 16, bottom: 32 },
      xAxis: {
        type: "category",
        data: ALGO_KEYS.map((k) => ALGO_LABELS[k]),
        axisLabel: { color: "#a1a1aa" },
      },
      yAxis: {
        type: "value",
        axisLabel: { color: "#a1a1aa" },
        splitLine: { lineStyle: { color: "#27272a" } },
      },
      series: [
        {
          type: "boxplot",
          itemStyle: { color: "#27272a", borderColor: "#a1a1aa" },
          data: ALGO_KEYS.map((k) => quartiles(payloads?.[k]?.raw_costs ?? [])),
        },
      ],
    }),
    [payloads],
  );

  // -- actions ---------------------------------------------------------------

  async function rename() {
    setBusy(true);
    try {
      await pyInvokeValidated("update_run", okResponseSchema, {
        run_id: detail.id,
        label: renameLabel,
      });
      toast.success("Run renamed");
      setRenameOpen(false);
      onChanged();
    } catch (err) {
      toast.error(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function duplicate() {
    try {
      await pyInvokeValidated("duplicate_run", okResponseSchema, {
        run_id: detail.id,
      });
      toast.success("Configuration duplicated as draft");
      onChanged();
    } catch (err) {
      toast.error(String(err));
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await pyInvokeValidated("delete_runs", deleteRunsResponseSchema, {
        run_ids: [detail.id],
        with_artifacts: false,
      });
      toast.success("Run deleted");
      setDeleteOpen(false);
      onDeleted();
    } catch (err) {
      toast.error(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function openDir() {
    try {
      await revealItemInDir(detail.output_dir);
    } catch (err) {
      toast.error(String(err));
    }
  }

  async function runExports() {
    setExportBusy(true);
    try {
      await pyInvokeValidated("run_exports", okResponseSchema, {
        run_id: detail.id,
        groups: exportGroups,
      });
    } catch (err) {
      setExportBusy(false);
      toast.error(String(err));
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-xl font-semibold">{detail.label}</h2>
          <Badge variant="outline">{detail.status}</Badge>
          <Badge variant="secondary">
            {detail.n_runs} runs x {detail.max_evals} evals
          </Badge>
          <Badge variant="outline">
            {detail.duration_s !== null
              ? formatDuration(detail.duration_s)
              : "in progress"}
          </Badge>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button size="icon" variant="outline">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            }
          />
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={() => {
                setRenameLabel(detail.label);
                setRenameOpen(true);
              }}
            >
              <Pencil className="mr-2 h-4 w-4" /> Rename
            </DropdownMenuItem>
            <DropdownMenuItem onClick={duplicate}>
              <Copy className="mr-2 h-4 w-4" /> Duplicate config
            </DropdownMenuItem>
            <DropdownMenuItem onClick={openDir}>
              <FolderOpen className="mr-2 h-4 w-4" /> Open output directory
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2 className="mr-2 h-4 w-4" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Exports */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Exports</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-4">
            {EXPORT_GROUPS.map((g) => (
              <label key={g.id} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={exportGroups.includes(g.id)}
                  onCheckedChange={(v) =>
                    setExportGroups((s) =>
                      v === true ? [...s, g.id] : s.filter((x) => x !== g.id),
                    )
                  }
                />
                {g.label}
              </label>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              size="sm"
              onClick={runExports}
              disabled={exportBusy || exportGroups.length === 0}
            >
              <Download className="mr-2 h-4 w-4" />
              {exportBusy ? "Exporting..." : "Run exports"}
            </Button>
            <Button size="sm" variant="outline" onClick={openDir}>
              <FolderOpen className="mr-2 h-4 w-4" />
              Open output directory
            </Button>
          </div>
          {lastArtifacts && (
            <div className="space-y-1 text-xs text-muted-foreground">
              {Object.entries(lastArtifacts).map(([group, paths]) => (
                <div key={group}>
                  <Badge variant="outline" className="mr-2">
                    {group}
                  </Badge>
                  {paths.join(", ")}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Scenario summary */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Scenario summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="max-h-[400px] overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Scenario</TableHead>
                  <TableHead>Algorithm</TableHead>
                  <TableHead className="text-right">median best</TableHead>
                  <TableHead className="text-right">mean best</TableHead>
                  <TableHead className="text-right">std</TableHead>
                  <TableHead className="text-right">conv %</TableHead>
                  <TableHead className="text-right">mean AUC</TableHead>
                  <TableHead className="text-right">mean wall</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.scenario_results.map((r) => (
                  <TableRow key={`${r.fname}_${r.dim}D_${r.algo_key}`}>
                    <TableCell>
                      {r.fname} {r.dim}D
                    </TableCell>
                    <TableCell>
                      <span
                        className="mr-2 inline-block h-2 w-2 rounded-full"
                        style={{
                          backgroundColor:
                            ALGO_COLORS[r.algo_key as AlgoKey] ?? "#fff",
                        }}
                      />
                      {ALGO_LABELS[r.algo_key as AlgoKey] ?? r.algo_key}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {formatSci(r.median_best)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {formatSci(r.mean_best)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {formatSci(r.std_best)}
                    </TableCell>
                    <TableCell className="text-right">
                      {r.conv_pct.toFixed(1)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {formatSci(r.mean_auc)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatMs(r.mean_wall_ms)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Distributions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Distributions</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="convergence">
            <TabsList>
              <TabsTrigger value="convergence">Convergence curve</TabsTrigger>
              <TabsTrigger value="box">Cost distribution</TabsTrigger>
              <TabsTrigger value="replay">3D replay</TabsTrigger>
              <TabsTrigger value="analyses">Statistical analyses</TabsTrigger>
            </TabsList>
            <TabsContent value="convergence" className="space-y-2">
              {scenarioKeys.length > 1 && (
                <Select
                  value={scenarioKey ?? undefined}
                  onValueChange={setScenarioKey}
                >
                  <SelectTrigger className="w-56">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {scenarioKeys.map((k) => (
                      <SelectItem key={k} value={k}>
                        {k}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {payloads ? (
                <Chart option={convergenceOption} />
              ) : (
                <p className="py-16 text-center text-sm text-muted-foreground">
                  Payloads not available.
                </p>
              )}
              {scenarioKey && (
                <BenchmarkSummaryTable
                  rows={detail.scenario_results.filter(
                    (r) => `${r.fname}_${r.dim}D` === scenarioKey,
                  )}
                />
              )}
            </TabsContent>
            <TabsContent value="box">
              {payloads ? (
                <Chart option={boxOption} />
              ) : (
                <p className="py-16 text-center text-sm text-muted-foreground">
                  Payloads not available.
                </p>
              )}
            </TabsContent>
            <TabsContent value="replay" className="space-y-3">
              {replayScenarioKeys.length === 0 ? (
                <p className="py-16 text-center text-sm text-muted-foreground">
                  No 2D scenarios in this run; 3D replay is unavailable.
                </p>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-3">
                    {replayScenarioKeys.length > 1 && (
                      <Select
                        value={scenarioKey ?? undefined}
                        onValueChange={setScenarioKey}
                      >
                        <SelectTrigger className="w-52">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {replayScenarioKeys.map((k) => (
                            <SelectItem key={k} value={k}>
                              {k}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    <Select
                      value={replayAlgo}
                      onValueChange={(v) => setReplayAlgo(v as AlgoKey)}
                    >
                      <SelectTrigger className="w-40">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ALGO_KEYS.map((k) => (
                          <SelectItem key={k} value={k}>
                            {ALGO_LABELS[k]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select
                      value={String(replayRun)}
                      onValueChange={(v) => setReplayRun(Number(v))}
                    >
                      <SelectTrigger className="w-36">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(payloads?.[replayAlgo]?.replay_histories ?? []).map(
                          (_, i) => (
                            <SelectItem key={i} value={String(i)}>
                              run {i + 1}
                            </SelectItem>
                          ),
                        )}
                      </SelectContent>
                    </Select>
                    <span
                      className="inline-block h-2 w-2 rounded-full"
                      style={{ backgroundColor: ALGO_COLORS[replayAlgo] }}
                    />
                  </div>
                  {replaySurfaceError ? (
                    <p className="py-16 text-center text-sm text-destructive">
                      Surface unavailable: {replaySurfaceError}
                    </p>
                  ) : !replaySurface ? (
                    <p className="py-16 text-center text-sm text-muted-foreground">
                      Loading surface...
                    </p>
                  ) : (
                    <Replay3D
                      surface={replaySurface}
                      algoKey={replayAlgo}
                      histories={replayHistory}
                      runIdx={replayRun}
                      payloadsByAlgo={payloads ?? {}}
                    />
                  )}
                </>
              )}
            </TabsContent>
            <TabsContent value="analyses">
              {analysis ? (
                <AnalysesReport
                  analysis={analysis}
                  scenarioResults={detail.scenario_results}
                  nRuns={detail.n_runs}
                />
              ) : (
                <p className="py-16 text-center text-sm text-muted-foreground">
                  Statistical analyses (report sections a-e) appear here once
                  the run finishes.
                </p>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Rename dialog */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename run</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>New label</Label>
            <Input
              value={renameLabel}
              onChange={(e) => setRenameLabel(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button onClick={rename} disabled={busy}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete this run?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Run metadata is removed from the history database. Artifacts on disk
            are kept.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={busy} onClick={remove}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * Per-benchmark summary statistics table, matching the DOCX report's
 * Per-Benchmark Results table (Algorithm | Conv % | Mean Best | Std | CV |
 * Mean Gen | Wall (ms)) for the selected scenario.
 */
function BenchmarkSummaryTable({
  rows,
}: {
  rows: RunDetailResponse["scenario_results"];
}) {
  const ordered = ALGO_KEYS.map(
    (ak) => [ak, rows.find((r) => r.algo_key === ak)] as const,
  ).filter(([, r]) => r !== undefined);

  if (ordered.length === 0) return null;

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Algorithm</TableHead>
          <TableHead className="text-right">Conv %</TableHead>
          <TableHead className="text-right">Mean Best</TableHead>
          <TableHead className="text-right">Std</TableHead>
          <TableHead className="text-right">CV</TableHead>
          <TableHead className="text-right">Mean Gen</TableHead>
          <TableHead className="text-right">Wall (ms)</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {ordered.map(([ak, r]) => (
          <TableRow key={ak}>
            <TableCell>
              <span
                className="mr-2 inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: ALGO_COLORS[ak] }}
              />
              {ALGO_LABELS[ak]}
            </TableCell>
            <TableCell className="text-right font-mono text-xs">
              {r!.conv_pct.toFixed(1)}
            </TableCell>
            <TableCell className="text-right font-mono text-xs">
              {r!.mean_best !== null ? r!.mean_best.toExponential(4) : "n/a"}
            </TableCell>
            <TableCell className="text-right font-mono text-xs">
              {r!.std_best !== null ? r!.std_best.toExponential(2) : "n/a"}
            </TableCell>
            <TableCell className="text-right font-mono text-xs">
              {r!.cv !== null ? r!.cv.toFixed(4) : "n/a"}
            </TableCell>
            <TableCell className="text-right font-mono text-xs">
              {r!.mean_conv_gen !== null ? r!.mean_conv_gen.toFixed(0) : "-"}
            </TableCell>
            <TableCell className="text-right font-mono text-xs">
              {r!.mean_wall_ms !== null ? r!.mean_wall_ms.toFixed(0) : "n/a"}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
