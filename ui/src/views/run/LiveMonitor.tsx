import { memo, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { AlertCircle, CheckCircle2, Play, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import ConvergenceChart from "@/components/charts/ConvergenceChart";
import LivePreviewCard from "@/components/scene/LivePreviewCard";
import { pyInvokeValidated } from "@/lib/api";
import {
  ALGO_COLORS,
  ALGO_LABELS,
  okResponseSchema,
  type AlgoKey,
} from "@/lib/schemas";
import { formatDuration, formatMs, formatSci } from "@/lib/formatters";
import {
  activeAlgos,
  overallProgress,
  useLiveStore,
  type LiveRow,
  type ScenarioSummary,
} from "@/stores/live";

const STATUS_BADGE: Record<
  string,
  {
    label: string;
    variant: "default" | "secondary" | "destructive" | "outline";
  }
> = {
  idle: { label: "idle", variant: "outline" },
  running: { label: "running", variant: "secondary" },
  completed: { label: "completed", variant: "default" },
  cancelled: { label: "cancelled", variant: "outline" },
  error: { label: "error", variant: "destructive" },
};

const ALGO_ORDER: AlgoKey[] = ["hyde_bin", "hyde_qub", "hyde_con", "hygo"];

/** Completed-scenario medians table; re-renders only when summaries change. */
const ScenarioSummariesTable = memo(function ScenarioSummariesTable({
  summaries,
}: {
  summaries: ScenarioSummary[];
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Scenario</TableHead>
          {ALGO_ORDER.map((k) => (
            <TableHead key={k} className="text-right">
              <span
                className="mr-1 inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: ALGO_COLORS[k] }}
              />
              {ALGO_LABELS[k]}
            </TableHead>
          ))}
          <TableHead className="text-right">best</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {summaries.map((s) => (
          <TableRow key={s.key}>
            <TableCell className="font-medium">{s.key}</TableCell>
            {ALGO_ORDER.map((k) => (
              <TableCell key={k} className="text-right font-mono text-xs">
                {formatSci(s.medians[k] ?? Number.NaN)}
              </TableCell>
            ))}
            <TableCell className="text-right">
              <Badge variant="secondary">
                {ALGO_LABELS[s.best_algo as AlgoKey] ?? s.best_algo}
              </Badge>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
});

/** Recent-run rows table; re-renders only when rows change. */
const RecentRunsTable = memo(function RecentRunsTable({
  rows,
}: {
  rows: LiveRow[];
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Scenario</TableHead>
          <TableHead>Algorithm</TableHead>
          <TableHead className="text-right">Run</TableHead>
          <TableHead className="text-right">Best cost</TableHead>
          <TableHead className="text-right">Wall</TableHead>
          <TableHead className="text-right">Conv gen</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.key}>
            <TableCell>
              {r.fname} {r.dim}D
            </TableCell>
            <TableCell>
              <span
                className="mr-2 inline-block h-2 w-2 rounded-full"
                style={{
                  backgroundColor: ALGO_COLORS[r.algo_key as AlgoKey] ?? "#fff",
                }}
              />
              {ALGO_LABELS[r.algo_key as AlgoKey] ?? r.algo_key}
            </TableCell>
            <TableCell className="text-right">
              {r.run_idx + 1}/{r.n_runs}
            </TableCell>
            <TableCell className="text-right font-mono text-xs">
              {formatSci(r.best_cost)}
            </TableCell>
            <TableCell className="text-right">{formatMs(r.wall_ms)}</TableCell>
            <TableCell className="text-right">{r.conv_gen ?? "-"}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
});

export default function LiveMonitor() {
  // event subscription is owned by the RunView wrapper (this component is
  // always rendered under it); subscribing here too would double-count events
  //
  // Fields are subscribed individually: telemetry events mutate only a few of
  // them, so the tables below (memoized on rows/summaries identity) skip
  // re-rendering at telemetry rate.
  const status = useLiveStore((s) => s.status);
  const error = useLiveStore((s) => s.error);
  const runId = useLiveStore((s) => s.runId);
  const totalRuns = useLiveStore((s) => s.totalRuns);
  const completedRuns = useLiveStore((s) => s.completedRuns);
  const scenarios = useLiveStore((s) => s.scenarios);
  const scenariosDone = useLiveStore((s) => s.scenariosDone);
  const elapsedS = useLiveStore((s) => s.elapsedS);
  const currentScenario = useLiveStore((s) => s.currentScenario);
  const currentScenarioDim = useLiveStore((s) => s.currentScenarioDim);
  const currentAlgo = useLiveStore((s) => s.currentAlgo);
  const curves = useLiveStore((s) => s.curves);
  const scenarioSummaries = useLiveStore((s) => s.scenarioSummaries);
  const rows = useLiveStore((s) => s.rows);
  const navigate = useNavigate();

  // keep an ETA estimate based on completed runs (rolling wall time)
  useEffect(() => {
    if (status !== "running") return;
    const id = setInterval(() => {
      useLiveStore.setState((s) => ({ elapsedS: s.elapsedS + 1 }));
    }, 1000);
    return () => clearInterval(id);
  }, [status]);

  const progress = overallProgress({ totalRuns, completedRuns });
  const etaS =
    completedRuns > 1
      ? (elapsedS / completedRuns) * (totalRuns - completedRuns)
      : null;
  const badge = STATUS_BADGE[status];

  async function cancel() {
    try {
      await pyInvokeValidated("cancel_benchmark", okResponseSchema);
      toast.info("Cancellation requested; finishing current run...");
    } catch (err) {
      toast.error(String(err));
    }
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Live</h1>
          <p className="text-sm text-muted-foreground">
            Real-time benchmark monitoring.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant={badge.variant} className="gap-1">
            {status === "running" && <Play className="h-3 w-3 animate-pulse" />}
            {status === "completed" && <CheckCircle2 className="h-3 w-3" />}
            {(status === "error" || status === "cancelled") && (
              <XCircle className="h-3 w-3" />
            )}
            {status === "error" && <AlertCircle className="h-3 w-3" />}
            {badge.label}
          </Badge>
          {status === "running" && (
            <Button variant="destructive" size="sm" onClick={cancel}>
              Cancel
            </Button>
          )}
          {(status === "completed" ||
            status === "cancelled" ||
            status === "error") && (
            <>
              {status === "completed" && (
                <Button
                  size="sm"
                  onClick={() =>
                    navigate("/results", { state: { runId: runId } })
                  }
                >
                  View results
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() => useLiveStore.getState().reset()}
              >
                New experiment
              </Button>
            </>
          )}
        </div>
      </div>

      {error && (
        <Card className="border-destructive">
          <CardContent className="pt-6 text-sm text-destructive">
            {error}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Progress
            {runId && (
              <code className="ml-2 text-xs font-normal text-muted-foreground">
                {runId.slice(0, 8)}
              </code>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Progress value={progress} />
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-muted-foreground">
            <span>
              runs:{" "}
              <span className="font-medium text-foreground">
                {completedRuns} / {totalRuns}
              </span>
            </span>
            <span>
              scenarios:{" "}
              <span className="font-medium text-foreground">
                {scenariosDone} / {scenarios}
              </span>
            </span>
            <span>
              elapsed:{" "}
              <span className="font-medium text-foreground">
                {formatDuration(elapsedS)}
              </span>
            </span>
            {etaS !== null && status === "running" && (
              <span>
                eta:{" "}
                <span className="font-medium text-foreground">
                  {formatDuration(etaS)}
                </span>
              </span>
            )}
            {currentScenario && (
              <span>
                now:{" "}
                <span className="font-medium text-foreground">
                  {currentScenario} {currentScenarioDim}D
                </span>
                {currentAlgo && (
                  <span
                    className="ml-2 inline-block h-2 w-2 rounded-full"
                    style={{
                      backgroundColor:
                        ALGO_COLORS[currentAlgo as AlgoKey] ?? "#fff",
                    }}
                  />
                )}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {/* Left column: live convergence + completed scenarios */}
        <div className="flex flex-col gap-6">
          <Card className="h-[420px]">
            <CardHeader>
              <CardTitle className="text-base">
                Live convergence
                {currentScenario && (
                  <span className="ml-2 text-sm font-normal text-muted-foreground">
                    {currentScenario} {currentScenarioDim}D
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {activeAlgos({ rows, curves }).length > 0 ? (
                <ConvergenceChart curves={curves} />
              ) : (
                <p className="py-16 text-center text-sm text-muted-foreground">
                  Waiting for the first generation telemetry...
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Completed scenarios</CardTitle>
            </CardHeader>
            <CardContent>
              {scenarioSummaries.length === 0 ? (
                <p className="py-16 text-center text-sm text-muted-foreground">
                  No scenario finished yet.
                </p>
              ) : (
                <div className="max-h-80 overflow-y-auto">
                  <ScenarioSummariesTable summaries={scenarioSummaries} />
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right column: 3D preview (stretches to match the left column) */}
        <Card className="flex h-full min-h-[600px] flex-col">
          <CardContent className="flex min-h-0 flex-1 flex-col pt-2">
            <LivePreviewCard />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Recent runs
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              (latest {rows.length})
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No run finished yet.
            </p>
          ) : (
            <div className="max-h-96 overflow-y-auto">
              <RecentRunsTable rows={rows} />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
