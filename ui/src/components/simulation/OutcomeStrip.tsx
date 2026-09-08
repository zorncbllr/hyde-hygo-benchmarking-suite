import { Target } from "lucide-react";
import { formatSci } from "@/lib/formatters";
import type { SimOutcome } from "@/lib/simulation";
import {
  ALGO_COLORS,
  ALGO_KEYS,
  ALGO_LABELS,
  type AlgoKey,
} from "@/lib/schemas";
import { cn } from "@/lib/utils";

interface OutcomeStripProps {
  outcomes: SimOutcome[];
  activeAlgo: AlgoKey;
}

/**
 * Session-scoped cross-algorithm comparison: final best cost and evaluations
 * used by each simulation already executed with the current parameters.
 * Lower best cost wins; ties broken by fewer evaluations.
 */
export default function OutcomeStrip({
  outcomes,
  activeAlgo,
}: OutcomeStripProps) {
  if (outcomes.length === 0) return null;

  const bestCost = Math.min(...outcomes.map((o) => o.bestCost));
  const winners = outcomes.filter((o) => o.bestCost === bestCost);
  const winnerKey =
    winners.sort((a, b) => a.evals - b.evals)[0]?.algoKey ?? null;

  // preserve the canonical algorithm order for stable rendering
  const ordered = ALGO_KEYS.flatMap((k) =>
    outcomes.filter((o) => o.algoKey === k),
  );

  return (
    <div className="rounded-lg border bg-card px-3 py-2.5">
      <div className="mb-2 flex items-center gap-2">
        <Target className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
          outcomes this session
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {ordered.map((o) => (
          <div
            key={o.algoKey}
            className={cn(
              "flex items-center gap-2 rounded-md border px-2 py-1 text-xs",
              o.algoKey === activeAlgo && "border-primary/60",
              o.algoKey === winnerKey && "bg-chart-2/10",
            )}
          >
            <span
              className="inline-block h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: ALGO_COLORS[o.algoKey as AlgoKey] }}
            />
            <span className="font-medium">
              {ALGO_LABELS[o.algoKey as AlgoKey] ?? o.algoKey}
            </span>
            <span className="font-mono">{formatSci(o.bestCost)}</span>
            <span className="font-mono text-muted-foreground">
              {o.evals} evals
            </span>
            {o.algoKey === winnerKey && (
              <span className="text-chart-2">best</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
