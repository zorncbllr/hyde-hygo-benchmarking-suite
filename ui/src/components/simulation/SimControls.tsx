import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Pause,
  Play,
  RotateCcw,
  SkipBack,
  SkipForward,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { SPEEDS, type SimPlayer } from "@/hooks/useSimPlayer";
import { cn } from "@/lib/utils";

interface SimControlsProps {
  player: SimPlayer;
}

/**
 * Transport controls for the trace playback: restart / step / play (single
 * execution lines), beat and phase navigation, speed, and a full-event
 * scrubber.
 */
export default function SimControls({ player }: SimControlsProps) {
  const {
    total,
    idx,
    setIdx,
    playing,
    togglePlay,
    restart,
    speed,
    setSpeed,
    stepForward,
    stepBack,
    jumpBeat,
    jumpPhase,
  } = player;

  return (
    <div className="space-y-2 rounded-lg border bg-card px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="icon" variant="ghost" title="Restart" onClick={restart}>
          <RotateCcw className="h-4 w-4" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          title="Previous phase"
          onClick={() => jumpPhase(-1)}
        >
          <ChevronsLeft className="h-4 w-4" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          title="Previous beat"
          onClick={() => jumpBeat(-1)}
        >
          <SkipBack className="h-4 w-4" />
        </Button>
        <Button
          size="icon"
          variant="outline"
          title="Step back"
          onClick={stepBack}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button
          size="icon"
          variant="outline"
          title={playing ? "Pause" : "Play"}
          onClick={togglePlay}
        >
          {playing ? (
            <Pause className="h-4 w-4" />
          ) : (
            <Play className="h-4 w-4" />
          )}
        </Button>
        <Button
          size="icon"
          variant="outline"
          title="Step forward"
          onClick={stepForward}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          title="Next beat"
          onClick={() => jumpBeat(1)}
        >
          <SkipForward className="h-4 w-4" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          title="Next phase"
          onClick={() => jumpPhase(1)}
        >
          <ChevronsRight className="h-4 w-4" />
        </Button>

        <div className="ml-auto flex items-center gap-1">
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

      <div className="flex items-center gap-3">
        <Slider
          value={[Math.min(idx, Math.max(0, total - 1))]}
          max={Math.max(0, total - 1)}
          step={1}
          onValueChange={(v) => {
            player.setPlaying(false);
            const val = Array.isArray(v) ? v[0] : Number(v);
            setIdx(typeof val === "number" ? val : 0);
          }}
        />
        <span
          className={cn(
            "whitespace-nowrap font-mono text-xs text-muted-foreground",
          )}
        >
          step {idx + 1}/{total}
        </span>
      </div>
    </div>
  );
}
