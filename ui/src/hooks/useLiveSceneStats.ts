import { useMemo } from "react";
import {
  ALGO_COLORS,
  ALGO_KEYS,
  ALGO_LABELS,
  type AlgoKey,
} from "@/lib/schemas";
import { formatSci } from "@/lib/formatters";
import type { SceneStatRow } from "@/components/scene/SceneStatsOverlay";
import { useLiveStore } from "@/stores/live";

/**
 * Builds per-algorithm stat rows for the live 3D overlay: session-best cost
 * per algorithm for the current scenario, with the leader highlighted.
 */
export function useLiveSceneStats(): {
  rows: SceneStatRow[];
  caption: string;
} {
  const algoStats = useLiveStore((s) => s.algoStats);
  const currentScenario = useLiveStore((s) => s.currentScenario);
  const currentDim = useLiveStore((s) => s.currentScenarioDim);
  const currentAlgo = useLiveStore((s) => s.currentAlgo);

  return useMemo(() => {
    const entries = ALGO_KEYS.filter((k) => algoStats[k]).map((k) => ({
      algo: k as AlgoKey,
      stat: algoStats[k],
    }));
    if (entries.length === 0) {
      return { rows: [], leaderKey: undefined, caption: "" };
    }
    const leader = entries.reduce((a, b) =>
      b.stat.best < a.stat.best ? b : a,
    );
    const rows: SceneStatRow[] = entries.map(({ algo, stat }) => ({
      key: algo,
      label: ALGO_LABELS[algo],
      color: ALGO_COLORS[algo],
      primary: formatSci(stat.best),
      secondary: `run ${stat.runIdx + 1} - gen ${stat.gen ?? "-"} - ${stat.evals} evals`,
    }));
    return {
      rows,
      leaderKey: leader.algo,
      caption: currentScenario
        ? `best cost - ${currentScenario} ${currentDim ?? ""}D`
        : "best cost",
    };
  }, [algoStats, currentScenario, currentDim, currentAlgo]);
}
