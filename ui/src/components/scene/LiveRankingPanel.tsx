import { Crown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ALGO_COLORS,
  ALGO_KEYS,
  ALGO_LABELS,
  type AlgoKey,
} from "@/lib/schemas";
import { formatSci } from "@/lib/formatters";
import type { AlgoStat } from "@/stores/live";

interface LiveRankingPanelProps {
  stats: Record<string, AlgoStat>;
  scenario: string | null;
  dim: number | null;
  /** compact = panel mode; full = maximized dialog mode */
  size?: "compact" | "full";
}

/**
 * Full-size live ranking dashboard shown in the 3D preview slot when the
 * running scenario has no 3D projection (25D). Ranked horizontal bars of
 * each algorithm's session-best cost; best = longest bar + crown.
 */
export default function LiveRankingPanel({
  stats,
  scenario,
  dim,
  size = "compact",
}: LiveRankingPanelProps) {
  const entries = ALGO_KEYS.filter((k) => stats[k]).map((k) => ({
    algo: k as AlgoKey,
    stat: stats[k],
  }));
  entries.sort((a, b) => a.stat.best - b.stat.best);

  if (entries.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Waiting for telemetry...
      </div>
    );
  }

  const best = entries[0].stat.best;
  const worst = entries[entries.length - 1].stat.best;
  const span = worst - best || 1;
  // best -> 100% width, worst -> 30%
  const widthFor = (value: number) => 30 + 70 * (1 - (value - best) / span);

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-4">
      <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        Live ranking - best cost
        {scenario && ` - ${scenario} ${dim ?? ""}D`}
      </div>
      <div className="flex flex-1 flex-col justify-center gap-3">
        {entries.map(({ algo, stat }, i) => (
          <div key={algo} className="space-y-1">
            <div className="flex items-center gap-2 text-sm">
              <span
                className={cn(
                  "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-xs font-bold",
                  i === 0
                    ? "bg-chart-2/20 text-chart-2"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {i + 1}
              </span>
              <span
                className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: ALGO_COLORS[algo] }}
              />
              <span className="w-24 font-medium">{ALGO_LABELS[algo]}</span>
              {i === 0 && (
                <span className="flex items-center gap-1 text-xs text-chart-2">
                  <Crown className="h-3.5 w-3.5" />
                  best
                </span>
              )}
              <span className="ml-auto font-mono text-sm">
                {formatSci(stat.best)}
              </span>
            </div>
            <div
              className={cn(
                "w-full overflow-hidden rounded bg-muted/50",
                size === "full" ? "h-4" : "h-2.5",
              )}
            >
              <div
                className="h-full rounded transition-all"
                style={{
                  width: `${widthFor(stat.best)}%`,
                  backgroundColor: ALGO_COLORS[algo],
                  opacity: i === 0 ? 1 : 0.55,
                }}
              />
            </div>
            <div
              className={cn(
                "text-xs text-muted-foreground",
                size === "full" && "text-sm",
              )}
            >
              run {stat.runIdx + 1} - gen {stat.gen ?? "-"} - {stat.evals} evals
              (last {formatSci(stat.last)})
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
