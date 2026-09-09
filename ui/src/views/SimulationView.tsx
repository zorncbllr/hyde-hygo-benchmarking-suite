import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Play } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import BehaviourCard from "@/components/simulation/BehaviourCard";
import CodePanel from "@/components/simulation/CodePanel";
import NarrationBar from "@/components/simulation/NarrationBar";
import OutcomeStrip from "@/components/simulation/OutcomeStrip";
import PhaseTimeline from "@/components/simulation/PhaseTimeline";
import SimConvergenceChart from "@/components/simulation/SimConvergenceChart";
import SimControls from "@/components/simulation/SimControls";
import SimScene, { type SimSceneView } from "@/components/simulation/SimScene";
import { useSimPlayer } from "@/hooks/useSimPlayer";
import { useSurface } from "@/hooks/useSurface";
import { formatSci } from "@/lib/formatters";
import { fetchTrace } from "@/lib/simTraceCache";
import type { SimulationTraceLoaded } from "@/lib/simTraceCodec";
import type { SimOutcome } from "@/lib/simulation";
import {
  ALGO_KEYS,
  ALGO_LABELS,
  CLI_TEST_CASES,
  simulationRequestSchema,
  type AlgoKey,
  type SimulationRequest,
} from "@/lib/schemas";

/** 2D-capable benchmark functions (mirror of the CLI scenario list). */
const SIM_FUNCTIONS = Array.from(
  new Set(CLI_TEST_CASES.filter((tc) => tc.dim === 2).map((tc) => tc.fname)),
);

const DEFAULTS = {
  algo: "hyde_bin" as AlgoKey,
  fname: "sphere",
  seed: 0,
  maxEvals: 400,
  popSize: 24,
};

/**
 * Interactive simulation workspace: main panel replays a line-level trace of
 * the selected algorithm over the 3D surface (with pedagogical narration and
 * phase navigation); the right panel shows the actual vendored source with
 * the currently executing line highlighted.
 */
export default function SimulationView() {
  const [algoKey, setAlgoKey] = useState<AlgoKey>(DEFAULTS.algo);
  const [fname, setFname] = useState(DEFAULTS.fname);
  const [seedStr, setSeedStr] = useState(String(DEFAULTS.seed));
  const [evalsStr, setEvalsStr] = useState(String(DEFAULTS.maxEvals));
  const [popStr, setPopStr] = useState(String(DEFAULTS.popSize));

  const [trace, setTrace] = useState<SimulationTraceLoaded | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<SimOutcome[]>([]);
  const [sceneView, setSceneView] = useState<SimSceneView>("map");
  const [maximized, setMaximized] = useState(false);

  const runIdRef = useRef(0);

  const parseConfig = useCallback((): SimulationRequest | null => {
    const parsed = simulationRequestSchema.safeParse({
      algo_key: algoKey,
      fname,
      seed: Number(seedStr),
      max_evals: Number(evalsStr),
      pop_size: Number(popStr),
    });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      toast.error(`Invalid simulation parameters: ${issue.message}`);
      return null;
    }
    return parsed.data;
  }, [algoKey, fname, seedStr, evalsStr, popStr]);

  const run = useCallback(
    async (silent: boolean) => {
      const req = parseConfig();
      if (!req) return;
      const runId = ++runIdRef.current;
      setLoading(true);
      setError(null);
      try {
        const t = await fetchTrace(req);
        if (runId !== runIdRef.current) return; // a newer run superseded this one
        setTrace(t);
        setOutcomes((prev) => [
          ...prev.filter((o) => o.algoKey !== t.algo_key),
          {
            algoKey: t.algo_key,
            fname: t.fname,
            seed: t.seed,
            maxEvals: t.max_evals,
            bestCost: t.result.best_cost,
            evals: t.result.evals,
            convGen: t.result.conv_gen,
          },
        ]);
        if (t.truncated && !silent) {
          toast.warning(
            "Trace truncated: event cap reached before the run ended.",
          );
        }
      } catch (err) {
        if (runId !== runIdRef.current) return;
        setError(String(err));
        if (!silent) toast.error(`Simulation failed: ${String(err)}`);
      } finally {
        if (runId === runIdRef.current) setLoading(false);
      }
    },
    [parseConfig],
  );

  // Initial run and re-run whenever the algorithm tab changes.
  useEffect(() => {
    void run(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [algoKey]);

  const player = useSimPlayer(trace);
  const { surface, error: surfaceError } = useSurface(fname);
  const frame = player.frame;
  const toggleMaximize = useCallback(() => setMaximized((m) => !m), []);

  const resultBadges = useMemo(() => {
    if (!trace) return null;
    return (
      <div className="flex items-center gap-1.5">
        <Badge variant="outline" className="font-mono text-xs">
          best {formatSci(trace.result.best_cost)}
        </Badge>
        <Badge variant="outline" className="font-mono text-xs">
          {trace.result.evals} evals
        </Badge>
        {trace.result.conv_gen !== null && (
          <Badge variant="outline" className="font-mono text-xs">
            conv gen {trace.result.conv_gen}
          </Badge>
        )}
        <Badge variant="outline" className="font-mono text-xs">
          {trace.n_events} steps
        </Badge>
      </div>
    );
  }, [trace]);

  return (
    <>
      <div className="flex h-full min-h-0 flex-col gap-3 p-4">
        {/* header: algorithm switcher + scenario config */}
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <h1 className="text-xl font-semibold">Simulation</h1>
            <p className="text-xs text-muted-foreground">
              Replay a real execution of the algorithm, line by line, on a small
              2D scenario.
            </p>
          </div>
          <Tabs value={algoKey} onValueChange={(v) => setAlgoKey(v as AlgoKey)}>
            <TabsList>
              {ALGO_KEYS.map((k) => (
                <TabsTrigger key={k} value={k} className="text-xs">
                  {ALGO_LABELS[k]}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          <div className="flex items-end gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Scenario (2D)</Label>
              <Select value={fname} onValueChange={(v) => setFname(v ?? fname)}>
                <SelectTrigger className="h-9 w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SIM_FUNCTIONS.map((f) => (
                    <SelectItem key={f} value={f}>
                      {f}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="sim-seed" className="text-xs">
                Seed
              </Label>
              <Input
                id="sim-seed"
                className="h-9 w-20"
                inputMode="numeric"
                value={seedStr}
                onChange={(e) => setSeedStr(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="sim-evals" className="text-xs">
                Max evals
              </Label>
              <Input
                id="sim-evals"
                className="h-9 w-24"
                inputMode="numeric"
                value={evalsStr}
                onChange={(e) => setEvalsStr(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="sim-pop" className="text-xs">
                Population
              </Label>
              <Input
                id="sim-pop"
                className="h-9 w-20"
                inputMode="numeric"
                value={popStr}
                onChange={(e) => setPopStr(e.target.value)}
              />
            </div>
            <Button
              className="h-9"
              onClick={() => void run(false)}
              disabled={loading}
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              Run
            </Button>
          </div>

          <div className="ml-auto">{resultBadges}</div>
        </div>

        {/* workspace: main panel + code sidebar */}
        <div className="flex min-h-0 flex-1 gap-3">
          {/* main panel */}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
            {trace && frame && (
              <>
                <PhaseTimeline
                  segments={player.segments}
                  currentIdx={frame.idx}
                  onJump={(i) => {
                    player.setPlaying(false);
                    player.setIdx(i);
                  }}
                />
                <NarrationBar frame={frame} />
              </>
            )}
            <div className="relative min-h-0 flex-1 overflow-hidden rounded-lg border">
              {surface && trace && frame ? (
                <SimScene
                  surface={surface}
                  algoKey={algoKey}
                  frame={frame}
                  view={sceneView}
                  onViewChange={setSceneView}
                  maximized={maximized}
                  onToggleMaximize={toggleMaximize}
                />
              ) : loading ? (
                <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Running traced simulation...
                </div>
              ) : (
                <div className="flex h-full items-center justify-center px-8 text-center text-sm text-muted-foreground">
                  {surfaceError
                    ? `Failed to load surface: ${surfaceError}`
                    : error
                      ? `Simulation failed: ${error}`
                      : "Run a simulation to see the trace."}
                </div>
              )}
            </div>
            {trace && frame && (
              <>
                <SimControls player={player} />
                <div className="grid shrink-0 grid-cols-2 gap-3">
                  <div className="rounded-lg border bg-card p-2">
                    <span className="mb-1 block px-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                      best cost so far
                    </span>
                    <SimConvergenceChart
                      algoKey={algoKey}
                      frame={frame}
                      maxEvals={trace.max_evals}
                      height={130}
                    />
                  </div>
                  <OutcomeStrip outcomes={outcomes} activeAlgo={algoKey} />
                </div>
              </>
            )}
          </div>

          {/* right sidebar: code of truth + design intent */}
          <div className="flex w-[560px] shrink-0 flex-col gap-2">
            <Tabs defaultValue="code" className="flex min-h-0 flex-1 flex-col">
              <TabsList>
                <TabsTrigger value="code" className="text-xs">
                  Code
                </TabsTrigger>
                <TabsTrigger value="intent" className="text-xs">
                  Design intent
                </TabsTrigger>
              </TabsList>
              <TabsContent value="code" className="mt-2 min-h-0 flex-1">
                {trace ? (
                  <CodePanel
                    source={trace.source}
                    currentLine={frame?.lineno ?? null}
                    beat={frame?.beat ?? null}
                    className="h-full"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                    No trace loaded yet.
                  </div>
                )}
              </TabsContent>
              <TabsContent
                value="intent"
                className="mt-2 min-h-0 flex-1 overflow-auto"
              >
                {trace ? (
                  <BehaviourCard source={trace.source} />
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                    No trace loaded yet.
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </div>

      {/* maximized workspace: map/3D scene and code execution side by side */}
      <Dialog open={maximized} onOpenChange={setMaximized}>
        <DialogContent className="flex h-screen max-h-screen w-screen max-w-none flex-col gap-3 overflow-hidden rounded-none border-none p-4 sm:max-w-none">
          <DialogHeader className="sr-only">
            <DialogTitle>Simulation - maximized</DialogTitle>
          </DialogHeader>
          {surface && trace && frame && (
            <div className="flex min-h-0 flex-1 gap-3">
              <div className="min-h-0 w-1/2 overflow-hidden rounded-lg border">
                <SimScene
                  surface={surface}
                  algoKey={algoKey}
                  frame={frame}
                  view={sceneView}
                  onViewChange={setSceneView}
                  maximized
                  onToggleMaximize={toggleMaximize}
                />
              </div>
              <div className="min-h-0 w-1/2">
                <CodePanel
                  source={trace.source}
                  currentLine={frame?.lineno ?? null}
                  beat={frame?.beat ?? null}
                  className="h-full"
                />
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
