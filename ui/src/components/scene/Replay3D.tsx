import { useEffect, useMemo, useState } from "react";
import { Pause, Play, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import BenchScene, { normalizePositions } from "@/components/scene/BenchScene";
import SceneStatsOverlay, {
  type SceneStatRow,
} from "@/components/scene/SceneStatsOverlay";
import { buildHeightField } from "@/components/scene/heightField";
import {
  ALGO_COLORS,
  ALGO_KEYS,
  ALGO_LABELS,
  type AlgoKey,
  type ScenarioPayload,
  type SurfaceResponse,
} from "@/lib/schemas";
import { formatSci } from "@/lib/formatters";

export interface ReplayEntry {
  g: number | null;
  p: [number, number] | null;
  c: Array<[number, number]> | null;
}

interface Replay3DProps {
  surface: SurfaceResponse;
  algoKey: AlgoKey;
  /** one history per run, each a list of generation entries */
  histories: ReplayEntry[][];
  runIdx: number;
  /** payloads for all algorithms of the scenario (for cross-algo stats) */
  payloadsByAlgo: Partial<Record<AlgoKey, ScenarioPayload>>;
}

const SPEEDS = [1, 2, 4, 8] as const;
const STEP_MS = 350;

/**
 * 3D replay of a stored run: animates the recorded per-generation population
 * snapshot and best-so-far trail over the benchmark surface.
 */
export default function Replay3D({
  surface,
  algoKey,
  histories,
  runIdx,
  payloadsByAlgo,
}: Replay3DProps) {
  const history = histories[runIdx] ?? [];
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(2);

  // reset when the replayed run changes
  useEffect(() => {
    setIdx(0);
    setPlaying(true);
  }, [algoKey, runIdx, histories]);

  useEffect(() => {
    if (!playing || history.length === 0) return;
    const id = setInterval(() => {
      setIdx((i) => {
        if (i >= history.length - 1) {
          setPlaying(false);
          return i;
        }
        return i + 1;
      });
    }, STEP_MS / speed);
    return () => clearInterval(id);
  }, [playing, speed, history.length]);

  const heightField = useMemo(
    () => buildHeightField(surface.zs, true),
    [surface],
  );
  const heightAt = heightField?.sample ?? (() => 1.0);

  const current = history[Math.min(idx, Math.max(0, history.length - 1))];
  const positions = useMemo(() => {
    if (!current?.c) return {};
    return normalizePositions({ [algoKey]: current.c }, surface);
  }, [current, algoKey, surface]);
  const trajectories = useMemo(() => {
    const trail = history
      .slice(0, idx + 1)
      .map((e) => e.p)
      .filter((p): p is [number, number] => p !== null);
    if (trail.length === 0) return {};
    return normalizePositions({ [algoKey]: trail }, surface);
  }, [history, idx, algoKey, surface]);

  // Per-algorithm stats at the current generation: cost read from the
  // recorded gen-best curve of the replayed run (falls back to the mean
  // curve for runs beyond the stored per-run curves). Leader = lowest cost.
  const statRows = useMemo<SceneStatRow[]>(() => {
    const gen = current?.g;
    const rows: SceneStatRow[] = [];
    for (const k of ALGO_KEYS) {
      const payload = payloadsByAlgo[k];
      if (!payload) continue;
      const curve =
        payload.curves && payload.curves[runIdx] !== undefined
          ? payload.curves[runIdx]
          : payload.mean_curve;
      if (!curve || curve.length === 0) continue;
      const cost = curve[Math.min(gen ?? idx, curve.length - 1)];
      rows.push({
        key: k,
        label: ALGO_LABELS[k],
        color: ALGO_COLORS[k],
        primary: formatSci(cost),
        value: cost,
        secondary: `gen ${gen ?? idx}`,
      });
    }
    return rows;
  }, [payloadsByAlgo, runIdx, current, idx]);

  if (history.length === 0) {
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">
        No replay data recorded for this run (3D replay is available for 2D
        scenarios run with this version).
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="h-[420px] w-full overflow-hidden rounded-lg border">
        <BenchScene
          surface={surface}
          logScale
          wireframe={false}
          positions={positions}
          trajectories={trajectories}
          heightAt={heightAt}
          overlay={
            <SceneStatsOverlay
              rows={statRows}
              caption="replay - best cost at gen"
            />
          }
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          size="icon"
          variant="outline"
          onClick={() => setPlaying((p) => !p)}
          title={playing ? "Pause" : "Play"}
        >
          {playing ? (
            <Pause className="h-4 w-4" />
          ) : (
            <Play className="h-4 w-4" />
          )}
        </Button>
        <Button
          size="icon"
          variant="ghost"
          title="Restart"
          onClick={() => {
            setIdx(0);
            setPlaying(true);
          }}
        >
          <RotateCcw className="h-4 w-4" />
        </Button>
        <div className="flex min-w-48 flex-1 items-center gap-3">
          <Slider
            value={[Math.min(idx, history.length - 1)]}
            max={history.length - 1}
            step={1}
            onValueChange={(v) => {
              setPlaying(false);
              const val = Array.isArray(v) ? v[0] : Number(v);
              setIdx(typeof val === "number" ? val : 0);
            }}
          />
          <span className="whitespace-nowrap text-xs text-muted-foreground">
            gen {current?.g ?? "-"} ({idx + 1}/{history.length})
          </span>
        </div>
        <div className="flex items-center gap-1">
          {SPEEDS.map((s) => (
            <Badge
              key={s}
              variant={speed === s ? "default" : "outline"}
              className="cursor-pointer"
              onClick={() => setSpeed(s)}
            >
              {s}x
            </Badge>
          ))}
        </div>
      </div>
    </div>
  );
}
