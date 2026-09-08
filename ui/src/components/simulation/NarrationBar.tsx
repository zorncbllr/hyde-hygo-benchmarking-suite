import { BookOpen } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { phaseColor, phaseLabel, type SimFrame } from "@/lib/simulation";

interface NarrationBarProps {
  frame: SimFrame;
}

/**
 * Pedagogical caption above the scene: what conceptual step the algorithm is
 * currently performing, with a one-paragraph explanation of why it exists.
 */
export default function NarrationBar({ frame }: NarrationBarProps) {
  const beat = frame.beat;
  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <div className="flex items-start gap-3">
        <BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              className="border-transparent font-medium text-white"
              style={{ backgroundColor: phaseColor(frame.phase) }}
            >
              {phaseLabel(frame.phase)}
            </Badge>
            <span className="font-mono text-xs text-muted-foreground">
              {frame.funcName} · line {frame.lineno}
            </span>
          </div>
          <p className="mt-1.5 text-sm font-medium leading-snug">
            {beat ? beat.title : "Untraced helper line"}
          </p>
          {beat && (
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {beat.body}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
