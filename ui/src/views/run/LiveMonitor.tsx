import { useEffect } from "react";
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
import { activeAlgos, overallProgress, useLiveStore } from "@/stores/live";

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

export default function LiveMonitor() {
  // event subscription is owned by the RunView wrapper (this component is
  // always rendered under it); subscribing here too would double-count events
  const store = useLiveStore();
  const navigate = useNavigate();

  // keep an ETA estimate based on completed runs (rolling wall time)
  useEffect(() => {
    if (store.status !== "running") return;
    const id = setInterval(() => {
      useLiveStore.setState((s) => ({ elapsedS: s.elapsedS + 1 }));
    }, 1000);
    return () => clearInterval(id);
  }, [store.status]);

  const progress = overallProgress(store);
  const etaS =
    store.completedRuns > 1
      ? (store.elapsedS / store.completedRuns) *
        (store.totalRuns - store.completedRuns)
      : null;
  const badge = STATUS_BADGE[store.status];

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
            {store.status === "running" && (
              <Play className="h-3 w-3 animate-pulse" />
            )}
            {store.status === "completed" && (
              <CheckCircle2 className="h-3 w-3" />
            )}
            {(store.status === "error" || store.status === "cancelled") && (
              <XCircle className="h-3 w-3" />
            )}
            {store.status === "error" && <AlertCircle className="h-3 w-3" />}
            {badge.label}
          </Badge>
          {store.status === "running" && (
            <Button variant="destructive" size="sm" onClick={cancel}>
              Cancel
            </Button>
          )}
          {(store.status === "completed" ||
            store.status === "cancelled" ||
            store.status === "error") && (
            <>
              {store.status === "completed" && (
                <Button
                  size="sm"
                  onClick={() =>
                    navigate("/results", { state: { runId: store.runId } })
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

      {store.error && (
        <Card className="border-destructive">
          <CardContent className="pt-6 text-sm text-destructive">
            {store.error}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Progress
            {store.runId && (
              <code className="ml-2 text-xs font-normal text-muted-foreground">
                {store.runId.slice(0, 8)}
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
                {store.completedRuns} / {store.totalRuns}
              </span>
            </span>
            <span>
              scenarios:{" "}
              <span className="font-medium text-foreground">
                {store.scenariosDone} / {store.scenarios}
              </span>
            </span>
            <span>
              elapsed:{" "}
              <span className="font-medium text-foreground">
                {formatDuration(store.elapsedS)}
              </span>
            </span>
            {etaS !== null && store.status === "running" && (
              <span>
                eta:{" "}
                <span className="font-medium text-foreground">
                  {formatDuration(etaS)}
                </span>
              </span>
            )}
            {store.currentScenario && (
              <span>
                now:{" "}
                <span className="font-medium text-foreground">
                  {store.currentScenario} {store.currentScenarioDim}D
                </span>
                {store.currentAlgo && (
                  <span
                    className="ml-2 inline-block h-2 w-2 rounded-full"
                    style={{
                      backgroundColor:
                        ALGO_COLORS[store.currentAlgo as AlgoKey] ?? "#fff",
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
                {store.currentScenario && (
                  <span className="ml-2 text-sm font-normal text-muted-foreground">
                    {store.currentScenario} {store.currentScenarioDim}D
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {activeAlgos(store).length > 0 ? (
                <ConvergenceChart curves={store.curves} />
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
              {store.scenarioSummaries.length === 0 ? (
                <p className="py-16 text-center text-sm text-muted-foreground">
                  No scenario finished yet.
                </p>
              ) : (
                <div className="max-h-80 overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Scenario</TableHead>
                        {(
                          [
                            "hyde_bin",
                            "hyde_qub",
                            "hyde_con",
                            "hygo",
                          ] as AlgoKey[]
                        ).map((k) => (
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
                      {store.scenarioSummaries.map((s) => (
                        <TableRow key={s.key}>
                          <TableCell className="font-medium">{s.key}</TableCell>
                          {(
                            [
                              "hyde_bin",
                              "hyde_qub",
                              "hyde_con",
                              "hygo",
                            ] as AlgoKey[]
                          ).map((k) => (
                            <TableCell
                              key={k}
                              className="text-right font-mono text-xs"
                            >
                              {formatSci(s.medians[k] ?? Number.NaN)}
                            </TableCell>
                          ))}
                          <TableCell className="text-right">
                            <Badge variant="secondary">
                              {ALGO_LABELS[s.best_algo as AlgoKey] ??
                                s.best_algo}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
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
              (latest {store.rows.length})
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {store.rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No run finished yet.
            </p>
          ) : (
            <div className="max-h-96 overflow-y-auto">
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
                  {store.rows.map((r) => (
                    <TableRow key={r.key}>
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
                      <TableCell className="text-right">
                        {r.run_idx + 1}/{r.n_runs}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {formatSci(r.best_cost)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatMs(r.wall_ms)}
                      </TableCell>
                      <TableCell className="text-right">
                        {r.conv_gen ?? "-"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
