import { useMemo, useState } from "react";
import { Maximize2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import BenchScene from "@/components/scene/BenchScene";
import { normalizePositions } from "@/lib/scene-utils";
import { buildHeightField } from "@/components/scene/heightField";
import { useSurface } from "@/hooks/useSurface";
import { useLiveStore } from "@/stores/live";
import SceneStatsOverlay from "@/components/scene/SceneStatsOverlay";
import LiveRankingPanel from "@/components/scene/LiveRankingPanel";
import { useLiveSceneStats } from "@/hooks/useLiveSceneStats";

const FALLBACK_FN = "ackley";

/**
 * Live 3D preview: surface of the currently running (2D) benchmark function
 * with the live population point cloud and best-so-far trail. Includes a
 * maximize button that opens the same scene in a fullscreen dialog.
 */
export default function LivePreviewCard() {
  const rawPositions = useLiveStore((s) => s.positions);
  const algoStats = useLiveStore((s) => s.algoStats);
  const rawTrajectories = useLiveStore((s) => s.trajectories);
  const currentScenario = useLiveStore((s) => s.currentScenario);
  const currentDim = useLiveStore((s) => s.currentScenarioDim);
  const last2DScenario = useLiveStore((s) => s.last2DScenario);

  const [maximized, setMaximized] = useState(false);

  const fname =
    currentScenario && currentDim === 2
      ? currentScenario
      : (last2DScenario ?? FALLBACK_FN);
  const { surface, error } = useSurface(fname);

  const heightField = useMemo(
    () => (surface ? buildHeightField(surface.zs, true) : null),
    [surface],
  );
  const positions = useMemo(
    () => (surface ? normalizePositions(rawPositions, surface) : {}),
    [rawPositions, surface],
  );
  const trajectories = useMemo(
    () => (surface ? normalizePositions(rawTrajectories, surface) : {}),
    [rawTrajectories, surface],
  );
  const heightAt = heightField?.sample ?? (() => 1.0);
  const { rows: statRows, caption: statsCaption } = useLiveSceneStats();
  const overlay = <SceneStatsOverlay rows={statRows} caption={statsCaption} />;

  const hasLive3D = currentDim === null || currentDim === 2;
  const body = (className: string) =>
    !hasLive3D ? (
      // 25D scenario running: fill the space with the live ranking
      <div className={className}>
        <LiveRankingPanel
          stats={algoStats}
          scenario={currentScenario}
          dim={currentDim}
        />
      </div>
    ) : error ? (
      <div
        className={`flex items-center justify-center text-sm text-destructive ${className}`}
      >
        Surface unavailable: {error}
      </div>
    ) : !surface ? (
      <div
        className={`flex items-center justify-center text-sm text-muted-foreground ${className}`}
      >
        Loading surface...
      </div>
    ) : (
      <div className={className}>
        <BenchScene
          surface={surface}
          logScale
          wireframe={false}
          positions={positions}
          trajectories={trajectories}
          heightAt={heightAt}
          overlay={overlay}
        />
      </div>
    );

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="mb-1 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium">
            3D preview
            <Badge variant="outline" className="text-xs">
              {fname}
            </Badge>
            {currentScenario && !hasLive3D && (
              <span className="text-xs text-muted-foreground">
                live: {currentScenario} {currentDim}D - ranking view
              </span>
            )}
          </div>
          <Button
            size="icon"
            variant="ghost"
            title="Maximize"
            onClick={() => setMaximized(true)}
          >
            <Maximize2 className="h-4 w-4" />
          </Button>
        </div>
        {body("min-h-0 flex-1 rounded-lg overflow-hidden border")}
      </div>

      <Dialog open={maximized} onOpenChange={setMaximized}>
        <DialogContent className="h-screen max-h-screen w-screen max-w-screen rounded-none border-none">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              3D preview
              <Badge variant="outline">{fname}</Badge>
              {currentScenario && (
                <span className="text-xs font-normal text-muted-foreground">
                  live: {currentScenario} {currentDim}D
                </span>
              )}
            </DialogTitle>
          </DialogHeader>
          {body("h-[calc(100vh-5rem)] w-full overflow-hidden")}
        </DialogContent>
      </Dialog>
    </>
  );
}
