import { useCallback, useEffect, useMemo, useState } from "react";
import {
  buildFrame,
  buildPhaseSegments,
  buildSnapshotIndex,
  nextBeatIndex,
  nextPhaseIndex,
  prevBeatIndex,
  prevPhaseIndex,
  type PhaseSegment,
  type SimFrame,
  type StepMode,
} from "@/lib/simulation";
import type { SimulationTraceLoaded } from "@/lib/simTraceCodec";

const STEP_MS = 350;
export const SPEEDS = [1, 2, 4, 8] as const;
export type Speed = (typeof SPEEDS)[number];

/**
 * Playback controller for a simulation trace: play/pause with speed,
 * line/beat stepping, phase navigation and the derived per-step frame.
 */
export function useSimPlayer(trace: SimulationTraceLoaded | null) {
  const decoded = trace?.decoded ?? null;
  const snaps = useMemo(
    () => buildSnapshotIndex(trace?.snapshots ?? []),
    [trace],
  );
  const segments = useMemo<PhaseSegment[]>(
    () => (trace && decoded ? buildPhaseSegments(decoded, trace.beats) : []),
    [trace, decoded],
  );

  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>(2);
  const [stepMode, setStepMode] = useState<StepMode>("line");

  // Reset playback whenever a new trace is loaded.
  useEffect(() => {
    setIdx(0);
    setPlaying(false);
  }, [trace]);

  const total = decoded?.n ?? 0;

  useEffect(() => {
    if (!playing || total === 0 || !decoded) return;
    const id = setInterval(() => {
      setIdx((i) => {
        if (i >= total - 1) {
          setPlaying(false);
          return i;
        }
        return stepMode === "beat" ? nextBeatIndex(decoded, i) : i + 1;
      });
    }, STEP_MS / speed);
    return () => clearInterval(id);
  }, [playing, speed, stepMode, total, decoded]);

  const stepForward = useCallback(() => {
    setPlaying(false);
    setIdx((i) => {
      if (!decoded) return i;
      const next = stepMode === "beat" ? nextBeatIndex(decoded, i) : i + 1;
      return Math.min(next, total - 1);
    });
  }, [decoded, stepMode, total]);

  const stepBack = useCallback(() => {
    setPlaying(false);
    setIdx((i) => Math.max(i - 1, 0));
  }, []);

  const jumpBeat = useCallback(
    (dir: 1 | -1) => {
      setPlaying(false);
      if (!decoded) return;
      setIdx((i) => {
        const next =
          dir === 1 ? nextBeatIndex(decoded, i) : prevBeatIndex(decoded, i);
        return Math.min(Math.max(next, 0), total - 1);
      });
    },
    [decoded, total],
  );

  const jumpPhase = useCallback(
    (dir: 1 | -1) => {
      setPlaying(false);
      if (!decoded) return;
      setIdx((i) => {
        const next =
          dir === 1
            ? nextPhaseIndex(decoded, segments, i)
            : prevPhaseIndex(segments, i);
        return Math.min(Math.max(next, 0), total - 1);
      });
    },
    [decoded, segments, total],
  );

  const restart = useCallback(() => {
    setPlaying(false);
    setIdx(0);
  }, []);

  const frame: SimFrame | null = useMemo(
    () => (trace && decoded ? buildFrame(trace, decoded, snaps, idx) : null),
    [trace, decoded, snaps, idx],
  );

  return {
    frame,
    segments,
    total,
    idx,
    setIdx,
    playing,
    setPlaying,
    togglePlay: () => setPlaying((p) => !p),
    restart,
    speed,
    setSpeed,
    stepMode,
    setStepMode,
    stepForward,
    stepBack,
    jumpBeat,
    jumpPhase,
  };
}

export type SimPlayer = ReturnType<typeof useSimPlayer>;
