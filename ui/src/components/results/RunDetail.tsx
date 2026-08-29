import { useEffect, useMemo, useState } from "react";
import * as echarts from "echarts";
import { z } from "zod";
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
  deleteRunsResponseSchema,
  exportDoneEventSchema,
  exportErrorEventSchema,
  exportProgressEventSchema,
  okResponseSchema,
  scenarioPayloadsResponseSchema,
  type AlgoKey,
  type RunDetailResponse,
  type ScenarioPayload,
} from "@/lib/schemas";
import { useSurface } from "@/hooks/useSurface";
import Replay3D from "@/components/scene/Replay3D";
import { pyInvokeValidated, subscribeValidated } from "@/lib/api";
import { formatDuration, formatMs, formatSci } from "@/lib/formatters";

const analysisSummarySchema = z.record(z.string(), z.unknown());
type AnalysisSummary = Record<string, unknown>;

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

/** Simple echarts host that rebuilds the option on change. */
function Chart({
  option,
  height = 300,
}: {
  option: echarts.EChartsOption;
  height?: number;
}) {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!el) return;
    const chart = echarts.init(el);
    chart.setOption(option);
    const onResize = () => chart.resize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      chart.dispose();
    };
  }, [el, option]);
  return <div ref={setEl} style={{ width: "100%", height }} />;
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
    pyInvokeValidated("get_analysis", analysisSummarySchema, {
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

  const convergenceOption = useMemo<echarts.EChartsOption>(
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

  const boxOption = useMemo<echarts.EChartsOption>(
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
              <TabsTrigger value="convergence">Convergence</TabsTrigger>
              <TabsTrigger value="box">Final cost box plot</TabsTrigger>
              <TabsTrigger value="replay">3D replay</TabsTrigger>
              <TabsTrigger value="analyses">Analyses</TabsTrigger>
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
                <AnalysisTables analysis={analysis} />
              ) : (
                <p className="py-16 text-center text-sm text-muted-foreground">
                  Statistical analyses appear here after running the exports for
                  this run.
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

function num(v: unknown): string {
  return typeof v === "number" ? v.toPrecision(6) : String(v);
}

function KVTable({ entries }: { entries: Array<[string, unknown]> }) {
  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">No data.</p>;
  }
  return (
    <Table>
      <TableBody>
        {entries.map(([k, v]) => (
          <TableRow key={k}>
            <TableCell className="font-medium">{k}</TableCell>
            <TableCell className="text-right font-mono text-xs">
              {num(v)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function scalarEntries(obj: Record<string, unknown>): Array<[string, unknown]> {
  return Object.entries(obj).filter(
    ([, v]) => typeof v === "number" || typeof v === "string" || v === null,
  );
}

function AnalysisTables({ analysis }: { analysis: AnalysisSummary }) {
  const friedman = (analysis.friedman_objective_error ?? {}) as Record<
    string,
    unknown
  >;
  const cochran = (analysis.cochrans_q ?? {}) as Record<string, unknown>;
  const wallTime = (analysis.friedman_wall_time ?? {}) as Record<
    string,
    unknown
  >;
  const margins = (analysis.margin_vs_hygo ?? []) as Array<
    Record<string, unknown>
  >;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <div>
        <h3 className="mb-2 text-sm font-medium">
          (a) Friedman objective error
        </h3>
        <KVTable entries={scalarEntries(friedman)} />
      </div>
      <div>
        <h3 className="mb-2 text-sm font-medium">(b) Cochran Q</h3>
        <KVTable entries={scalarEntries(cochran)} />
      </div>
      <div>
        <h3 className="mb-2 text-sm font-medium">(c) Friedman wall time</h3>
        <KVTable entries={scalarEntries(wallTime)} />
      </div>
      <div className="lg:col-span-3">
        <h3 className="mb-2 text-sm font-medium">
          (d) Margin vs HyGO (Wilcoxon + bootstrap CI)
        </h3>
        {margins.length === 0 ? (
          <p className="text-sm text-muted-foreground">No data.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                {Object.keys(margins[0]).map((k) => (
                  <TableHead key={k}>{k}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {margins.map((row, i) => (
                <TableRow key={i}>
                  {Object.keys(margins[0]).map((k) => (
                    <TableCell key={k} className="font-mono text-xs">
                      {String(row[k])}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
