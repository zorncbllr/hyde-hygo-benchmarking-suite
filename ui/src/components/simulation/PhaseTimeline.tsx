import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { phaseColor, phaseLabel, type PhaseSegment } from "@/lib/simulation";

interface PhaseTimelineProps {
  segments: PhaseSegment[];
  currentIdx: number;
  onJump: (eventIdx: number) => void;
}

/**
 * Horizontal map of the trace's phase segments (contiguous runs of the same
 * conceptual phase). Clicking a segment jumps the player to its first step;
 * the active segment is outlined. This is the primary navigation for
 * understanding the macro structure of a run.
 */
export default function PhaseTimeline({
  segments,
  currentIdx,
  onJump,
}: PhaseTimelineProps) {
  const activeSegIdx = useMemo(() => {
    let lo = 0;
    let hi = segments.length - 1;
    let ans = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      if (segments[mid].from <= currentIdx) {
        ans = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return ans;
  }, [segments, currentIdx]);

  if (segments.length === 0) return null;

  return (
    <div className="rounded-lg border bg-card px-3 py-2">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
          run structure
        </span>
        <span className="text-[10px] text-muted-foreground">
          {phaseLabel(segments[activeSegIdx]?.phase ?? null)} · segment{" "}
          {activeSegIdx + 1}/{segments.length}
        </span>
      </div>
      <div className="flex h-5 w-full items-stretch gap-px">
        {segments.map((seg, i) => {
          const active = i === activeSegIdx;
          return (
            <button
              key={i}
              type="button"
              title={`${phaseLabel(seg.phase)} (steps ${seg.from + 1}-${seg.to})`}
              onClick={() => onJump(seg.from)}
              className={cn(
                "min-w-[3px] transition-all",
                active
                  ? "z-10 rounded-sm ring-2 ring-foreground ring-offset-1 ring-offset-card"
                  : "opacity-35 hover:opacity-60",
              )}
              style={{
                flexGrow: seg.to - seg.from,
                backgroundColor: active
                  ? phaseColor(seg.phase || null)
                  : phaseColor(seg.phase || null),
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
