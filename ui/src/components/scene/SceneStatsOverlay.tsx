import { Crown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SceneStatRow {
  key: string;
  label: string;
  color: string;
  /** primary metric, e.g. best cost */
  primary: string;
  /** numeric value used for ranking (lower is better) */
  value?: number;
  /** optional secondary metrics, e.g. gen / evals */
  secondary?: string;
}

interface SceneStatsOverlayProps {
  rows: SceneStatRow[];
  caption?: string;
}

/**
 * Compact per-algorithm stats HUD rendered on top of 3D scenes.
 * Rows are ranked by their numeric value (lower is better; rows without a
 * value keep their insertion order at the bottom). Rank 1 gets a crown.
 */
export default function SceneStatsOverlay({
  rows,
  caption,
}: SceneStatsOverlayProps) {
  if (rows.length === 0) return null;

  const withIndex = rows.map((row, i) => ({ row, i }));
  const sorted = [...withIndex].sort((a, b) => {
    const va = a.row.value;
    const vb = b.row.value;
    if (va === undefined && vb === undefined) return a.i - b.i;
    if (va === undefined) return 1;
    if (vb === undefined) return -1;
    return va - vb;
  });

  return (
    <div className="pointer-events-none absolute top-2 left-2 z-10 space-y-1 rounded-md border bg-background/80 px-2 py-1.5 text-xs shadow-sm backdrop-blur">
      {caption && (
        <div className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
          {caption}
        </div>
      )}
      {sorted.map(({ row }, position) => {
        const rank = position + 1;
        return (
          <div
            key={row.key}
            className={cn(
              "flex items-center gap-2 rounded px-1 py-0.5",
              rank === 1 && "bg-primary/10 font-semibold",
            )}
          >
            <span
              className={cn(
                "inline-flex w-6 shrink-0 items-center justify-center rounded text-[10px] font-bold",
                rank === 1
                  ? "bg-chart-2/20 text-chart-2"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {rank}
            </span>
            <span
              className="inline-block h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: row.color }}
            />
            <span className="w-20 truncate">{row.label}</span>
            <span className="font-mono">{row.primary}</span>
            {row.secondary && (
              <span className="text-muted-foreground">{row.secondary}</span>
            )}
            {rank === 1 && (
              <span className="flex items-center gap-0.5 text-chart-2">
                <Crown className="h-3 w-3" />
                best
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
