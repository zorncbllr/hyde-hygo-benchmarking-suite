import { useMemo, useState } from "react";
import { Maximize2, Minimize2, Box, Map } from "lucide-react";
import BenchScene from "@/components/scene/BenchScene";
import SceneStatsOverlay, {
  type SceneStatRow,
} from "@/components/scene/SceneStatsOverlay";
import SimMap2D from "@/components/simulation/SimMap2D";
import { buildHeightField } from "@/components/scene/heightField";
import { normalizePositions } from "@/lib/scene-utils";
import { phaseLabel, type SimFrame } from "@/lib/simulation";
import {
  ALGO_COLORS,
  ALGO_LABELS,
  type AlgoKey,
  type SimOps,
  type SurfaceResponse,
} from "@/lib/schemas";
import { formatSci } from "@/lib/formatters";
import { cn } from "@/lib/utils";

export type SimSceneView = "map" | "3d";

interface SimSceneProps {
  surface: SurfaceResponse;
  algoKey: AlgoKey;
  frame: SimFrame;
  /** controlled map/3d view; hoisted so the maximized dialog keeps the same view */
  view?: SimSceneView;
  onViewChange?: (view: SimSceneView) => void;
  /** whether this instance fills the maximized dialog */
  maximized?: boolean;
  /** when provided, renders a maximize/minimize toggle in the scene toolbar */
  onToggleMaximize?: () => void;
  /** playback reached the last event: highlight the best returned result */
  atEnd?: boolean;
}

/**
 * Visualization of the simulated algorithm state. Default view is the
 * comprehension-first top-down contour map (population + movement arrows +
 * trail); the 3D surface remains available as a secondary perspective.
 */
export default function SimScene({
  surface,
  algoKey,
  frame,
  view: viewProp,
  onViewChange,
  maximized = false,
  onToggleMaximize,
  atEnd = false,
}: SimSceneProps) {
  const [localView, setLocalView] = useState<SimSceneView>("map");
  const view = viewProp ?? localView;
  const setView = (v: SimSceneView) => {
    setLocalView(v);
    onViewChange?.(v);
  };

  const heightField = useMemo(
    () => buildHeightField(surface.zs, true),
    [surface],
  );

  const positions = useMemo(() => {
    if (!frame.positions || frame.positions.length === 0) return {};
    return normalizePositions({ [algoKey]: frame.positions }, surface);
  }, [frame.positions, algoKey, surface]);

  const trajectories = useMemo(() => {
    if (frame.trail.length === 0) return {};
    return normalizePositions({ [algoKey]: frame.trail }, surface);
  }, [frame.trail, algoKey, surface]);

  const statRows = useMemo<SceneStatRow[]>(() => {
    const row: SceneStatRow = {
      key: algoKey,
      label: ALGO_LABELS[algoKey],
      color: ALGO_COLORS[algoKey],
      primary: Number.isFinite(frame.bestCost)
        ? formatSci(frame.bestCost)
        : "-",
      value: frame.bestCost,
      secondary: `evals ${frame.evalCount} · gen ${frame.genNumber ?? "-"}`,
    };
    return [row];
  }, [algoKey, frame.bestCost, frame.evalCount, frame.genNumber]);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-lg border">
      {view === "map" ? (
        <SimMap2D
          surface={surface}
          algoKey={algoKey}
          positions={frame.positions}
          prevPositions={frame.prevPositions}
          trail={frame.trail}
          bestX={frame.bestX}
          ops={frame.ops}
          highlightResult={atEnd}
        />
      ) : (
        <BenchScene
          surface={surface}
          logScale
          wireframe={false}
          positions={positions}
          trajectories={trajectories}
          heightAt={heightField?.sample ?? (() => 1.0)}
          pointSize={0.055}
          trailWidth={3}
          palette="redblack"
        />
      )}
      <SceneStatsOverlay
        rows={statRows}
        caption={`${phaseLabel(frame.phase)} - best cost`}
      />
      <div className="absolute bottom-2 left-2 z-10 flex max-w-[70%] flex-wrap items-center gap-x-3 gap-y-1 rounded-md border bg-background/80 px-2 py-1 text-[10px] text-muted-foreground shadow-sm backdrop-blur">
        <span className="flex items-center gap-1">
          <svg width="14" height="8" aria-hidden>
            <line
              x1="1"
              y1="4"
              x2="10"
              y2="4"
              stroke="#ffffff"
              strokeWidth="2"
            />
            <path d="M10 1 L14 4 L10 7 Z" fill="#ffffff" />
          </svg>
          individual moved this generation
        </span>
        <span className="flex items-center gap-1">
          <svg width="14" height="8" aria-hidden>
            <line
              x1="1"
              y1="4"
              x2="13"
              y2="4"
              stroke={ALGO_COLORS[algoKey]}
              strokeWidth="2"
            />
          </svg>
          best-so-far path (each hop = new best)
        </span>
        <span className="flex items-center gap-1">
          <svg width="10" height="10" aria-hidden>
            <circle
              cx="5"
              cy="5"
              r="3.5"
              fill="none"
              stroke="#ffffff"
              strokeWidth="1.5"
            />
          </svg>
          current best
        </span>
        {frame.ops && <OpLegend ops={frame.ops} />}
      </div>
      <div className="absolute top-2 right-2 z-10 flex items-start gap-1.5">
        <div className="flex overflow-hidden rounded-md border bg-background/80 p-0.5 shadow-sm backdrop-blur">
          <button
            type="button"
            title="Top-down contour map"
            onClick={() => setView("map")}
            className={cn(
              "flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors",
              view === "map"
                ? "bg-primary/20 font-medium text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Map className="h-3.5 w-3.5" />
            Map
          </button>
          <button
            type="button"
            title="3D surface perspective"
            onClick={() => setView("3d")}
            className={cn(
              "flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors",
              view === "3d"
                ? "bg-primary/20 font-medium text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Box className="h-3.5 w-3.5" />
            3D
          </button>
        </div>
        {onToggleMaximize && (
          <button
            type="button"
            title={maximized ? "Minimize" : "Maximize"}
            aria-label={
              maximized
                ? "Minimize map visualization"
                : "Maximize map visualization"
            }
            onClick={onToggleMaximize}
            className={cn(
              "flex items-center gap-1 rounded-md border bg-background/80 px-2 py-1 text-xs shadow-sm backdrop-blur transition-colors",
              maximized
                ? "bg-primary/20 font-medium text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {maximized ? (
              <Minimize2 className="h-3.5 w-3.5" />
            ) : (
              <Maximize2 className="h-3.5 w-3.5" />
            )}
            {maximized ? "Minimize" : "Maximize"}
          </button>
        )}
      </div>
    </div>
  );
}

/** Legend line for the operator overlay currently on the map. */
function OpLegend({ ops }: { ops: SimOps }) {
  let text: string;
  switch (ops.type) {
    case "lhs": {
      const parts = ["LHS strata: one sample per row/column (shaded cells)"];
      if (ops.qubit) parts.push("sin^2-warped strata (sampled in theta)");
      if (ops.reorder && ops.stage === "reorder")
        parts.push(
          "reorder: bright = far from selected (picked next), ring = next pick, numbers = visit order",
        );
      else if (ops.reorder && ops.stage === "final")
        parts.push("numbers = farthest-point visit order");
      text = parts.join(" - ");
      break;
    }
    case "mutation":
      text =
        "DE: dashed = pull to best, dotted = r1-r2, solid = mutation step; dot = crossover child (green accepted / rose rejected)";
      break;
    case "bitflip":
      text = "recovery: random bit-flip jumps (worst half)";
      break;
    case "gauss":
      text = "recovery: adaptive Gaussian kicks (worst half)";
      break;
    case "tunnel":
      text = "tunneling: reflection through the bounds center";
      break;
    case "cmaes":
      text = "CMA-ES sampling distribution (1-sigma / 2-sigma)";
      break;
    case "ga":
      text = "GA: parent -> child links (color = operator)";
      break;
    case "dsm":
      text = "DSM: simplex, centroid c, active move";
      break;
  }
  return (
    <span className="font-medium text-foreground/80" data-testid="op-legend">
      {text}
    </span>
  );
}
