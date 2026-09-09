import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildFrame,
  buildPhaseSegments,
  buildSnapshotIndex,
  fastForwardIndex,
  nextBeatIndex,
  nextPhaseIndex,
  prevBeatIndex,
  prevPhaseIndex,
  type PhaseSegment,
  type SimFrame,
  type StepMode,
} from "@/lib/simulation";
import type { SimulationTraceLoaded } from "@/lib/simTraceCodec";

/** fixed scheduler cadence; speed scales how many events advance per tick */
const TICK_MS = 40;
/**
 * Playback pacing: at 1x the whole trace completes in about a minute,
 * regardless of trace length. Comprehension phases (initialization with
 * the farthest-point walk, and CMA-ES) get a per-snapshot dwell inside
 * that budget (capped per phase); all remaining events share the rest.
 */
const TARGET_PLAYBACK_S = 60;
/** dwell per gen snapshot in the comprehension phases */
const SNAP_DWELL_S = 0.5;
/** max total dwell per comprehension phase */
const PHASE_DWELL_MAX_S = 12;
const DWELL_PHASES: ReadonlySet<string> = new Set(["init", "cmaes"]);
const MIN_EVENTS_PER_S = 6;
/** beats per second at 1x in beat step mode (a reading pace) */
const BEATS_PER_S = 3;
export const SPEEDS = [1, 2, 4] as const;
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

  // Per-trace pacing: comprehension phases (init / cmaes) get a per-
  // snapshot dwell (capped per phase), the remaining events share the
  // leftover budget so playback totals exactly one minute at 1x. A
  // fixed tick with a fractional accumulator advances multiple events
  // per tick (one buildFrame per tick, not per event).
  const pacing = useMemo(() => {
    if (total === 0 || !decoded || !trace) {
      return {
        init: MIN_EVENTS_PER_S,
        cmaes: MIN_EVENTS_PER_S,
        rest: MIN_EVENTS_PER_S,
      };
    }
    const beats = trace.beats;
    const snapCount: Record<string, number> = { init: 0, cmaes: 0 };
    for (const s of trace.snapshots) {
      if (s.kind === "gen" && s.phase && DWELL_PHASES.has(s.phase)) {
        snapCount[s.phase] = (snapCount[s.phase] ?? 0) + 1;
      }
    }
    const evCount: Record<string, number> = { init: 0, cmaes: 0 };
    for (let k = 0; k < total; k++) {
      const bi = decoded.beatIdxs[k];
      const ph = bi >= 0 ? (beats[bi]?.phase ?? "") : "";
      if (ph === "init" || ph === "cmaes") evCount[ph]++;
    }
    const dwell = (ph: string): number => {
      const snaps = snapCount[ph] ?? 0;
      return snaps > 0 ? Math.min(snaps * SNAP_DWELL_S, PHASE_DWELL_MAX_S) : 0;
    };
    const tInit = dwell("init");
    const tCmaes = dwell("cmaes");
    const tRest = Math.max(TARGET_PLAYBACK_S - tInit - tCmaes, 5);
    return {
      init: Math.max(evCount.init / Math.max(tInit, 0.5), MIN_EVENTS_PER_S),
      cmaes: Math.max(evCount.cmaes / Math.max(tCmaes, 0.5), MIN_EVENTS_PER_S),
      rest: Math.max(
        (total - evCount.init - evCount.cmaes) / tRest,
        MIN_EVENTS_PER_S,
      ),
    };
  }, [trace, decoded, total]);

  const accRef = useRef(0);
  useEffect(() => {
    if (!playing || total === 0 || !decoded || !trace) return;
    accRef.current = 0;
    const beats = trace.beats;
    const id = setInterval(() => {
      setIdx((i) => {
        if (i >= total - 1) {
          setPlaying(false);
          return i;
        }
        // comprehension phases keep their per-snapshot dwell regardless
        // of how fast the rest of the trace plays
        const bi = decoded.beatIdxs[i];
        const phase = bi >= 0 ? (beats[bi]?.phase ?? "") : "";
        const eps =
          phase === "init"
            ? pacing.init
            : phase === "cmaes"
              ? pacing.cmaes
              : pacing.rest;
        const perTick =
          stepMode === "beat"
            ? (BEATS_PER_S * speed * TICK_MS) / 1000
            : (eps * speed * TICK_MS) / 1000;
        accRef.current += perTick;
        if (stepMode === "beat") {
          if (accRef.current < 1) return i;
          accRef.current -= 1;
          return nextBeatIndex(decoded, i);
        }
        const advance = Math.floor(accRef.current);
        if (advance <= 0) return i;
        accRef.current -= advance;
        // blast through mechanical encode/decode stretches in one step
        return fastForwardIndex(
          decoded,
          beats,
          Math.min(i + advance, total - 1),
        );
      });
    }, TICK_MS);
    return () => clearInterval(id);
  }, [playing, speed, stepMode, total, decoded, trace, pacing]);

  const stepForward = useCallback(() => {
    setPlaying(false);
    setIdx((i) => {
      if (!decoded || !trace) return i;
      if (stepMode === "beat") {
        return Math.min(nextBeatIndex(decoded, i), total - 1);
      }
      const next = fastForwardIndex(
        decoded,
        trace.beats,
        Math.min(i + 1, total - 1),
      );
      return Math.min(next, total - 1);
    });
  }, [decoded, trace, stepMode, total]);

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
