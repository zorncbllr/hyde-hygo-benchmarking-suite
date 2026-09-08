import { useEffect, useMemo, useRef } from "react";
import { cn } from "@/lib/utils";
import { tokenizePython, type PyToken } from "@/lib/pyTokens";
import type { SimulationBeat } from "@/lib/schemas";

// -- JetBrains "New Dark" palette -------------------------------------------
// Matches the modern IntelliJ/PyCharm dark editor theme: violet keywords,
// blue function definitions and calls, green strings, near-black editor.

const TOKEN_CLASS: Record<PyToken["kind"], string> = {
  plain: "text-[#bcbec4]",
  comment: "text-[#6b6f76] italic",
  string: "text-[#55b45e]",
  keyword: "text-[#9e86fc]",
  builtin: "text-[#bcbec4]",
  number: "text-[#6fafee]",
  decorator: "text-[#d19a66]",
  def: "text-[#56a8f5]",
  classDef: "text-[#9e86fc]",
  call: "text-[#56a8f5]",
};

interface CodePanelProps {
  source: string;
  currentLine: number | null;
  /** active beat region (soft tint over [start_line, end_line]) */
  beat: SimulationBeat | null;
  className?: string;
}

/**
 * The actual vendored Python source of the simulated algorithm, line-numbered
 * with lightweight syntax highlighting. The currently executing line is
 * strongly highlighted; the surrounding curated-beat region is softly tinted.
 */
export default function CodePanel({
  source,
  currentLine,
  beat,
  className,
}: CodePanelProps) {
  const lines = useMemo(() => tokenizePython(source), [source]);
  const containerRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const lastScrolled = useRef<number | null>(null);

  useEffect(() => {
    if (currentLine == null) return;
    const row = rowRefs.current.get(currentLine);
    if (!row) return;
    // smooth scrolling on every playback step thrashes the WebView; only
    // animate for big jumps (beat/phase navigation), else scroll instantly
    const prev = lastScrolled.current;
    lastScrolled.current = currentLine;
    const jump = prev == null ? Infinity : Math.abs(currentLine - prev);
    row.scrollIntoView({
      block: "center",
      behavior: jump > 12 ? "smooth" : "auto",
    });
  }, [currentLine]);

  const gutterWidth = String(lines.length).length;

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative h-full overflow-auto rounded-lg border border-[#26272b] bg-[#121316]",
        className,
      )}
    >
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[#26272b] bg-[#121316]/95 px-3 py-1.5 backdrop-blur">
        <span className="text-[10px] font-medium tracking-wide text-[#6b6f76] uppercase">
          source of truth
        </span>
        <span className="font-mono text-[10px] text-[#6b6f76]">
          line {currentLine ?? "-"}
        </span>
      </div>
      <div className="min-w-max py-2 font-mono text-xs leading-5">
        {lines.map((tokens, lineIdx) => {
          const no = lineIdx + 1;
          const inBeat =
            beat !== null && no >= beat.start_line && no <= beat.end_line;
          const isCurrent = no === currentLine;
          return (
            <div
              key={no}
              ref={(el) => {
                if (el) rowRefs.current.set(no, el);
                else rowRefs.current.delete(no);
              }}
              className={cn(
                "flex border-l-2 px-2",
                inBeat && !isCurrent && "bg-white/[0.055]",
                isCurrent
                  ? "border-primary bg-primary/15"
                  : "border-transparent",
              )}
            >
              <span
                className={cn(
                  "shrink-0 pr-3 text-right select-none",
                  gutterWidth > 3 ? "w-12" : "w-9",
                  isCurrent ? "font-semibold text-[#d4d7d9]" : "text-[#606366]",
                )}
              >
                {no}
              </span>
              <code className="whitespace-pre">
                {tokens.length === 0
                  ? " "
                  : tokens.map((tok, i) => (
                      <span key={i} className={TOKEN_CLASS[tok.kind]}>
                        {tok.text}
                      </span>
                    ))}
              </code>
            </div>
          );
        })}
      </div>
    </div>
  );
}
