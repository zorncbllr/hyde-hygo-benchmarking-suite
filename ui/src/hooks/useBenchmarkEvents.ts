import { useEffect, useRef } from "react";
import { useLiveStore } from "@/stores/live";
import { pyInvokeValidated, subscribeValidated } from "@/lib/api";
import {
  activeRunResponseSchema,
  cancelledEventSchema,
  completeEventSchema,
  errorEventSchema,
  runDoneEventSchema,
  scenarioDoneEventSchema,
  startedEventSchema,
  telemetryEventSchema,
  type TelemetryEvent,
} from "@/lib/schemas";

/** Telemetry coalescing window: store writes happen at most once per window. */
export const TELEMETRY_FLUSH_MS = 100;

/** Subscribes the mounted component to all benchmark events. */
export function useBenchmarkEvents() {
  // Newest telemetry event per algorithm awaiting flush.
  const pendingRef = useRef(new Map<string, TelemetryEvent>());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Late mounts miss events emitted before subscription; sync once.
    pyInvokeValidated("get_active_run", activeRunResponseSchema)
      .then((snap) => useLiveStore.getState().syncActive(snap))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const pending = pendingRef.current;

    const flushTelemetry = () => {
      timerRef.current = null;
      const store = useLiveStore.getState();
      for (const event of pending.values()) {
        store.applyTelemetry(event);
      }
      pending.clear();
    };

    /**
     * Coalesce telemetry: keep only the newest event per algorithm and flush
     * at most once per window. Intermediate frames carry no information that
     * the newest one lacks (best-so-far curves are monotone), so dropping
     * them caps render churn at 10 Hz instead of 4 x emitter rate.
     */
    const scheduleTelemetry = (p: TelemetryEvent) => {
      pending.set(p.algo_key, p);
      if (timerRef.current !== null) return;
      timerRef.current = setTimeout(flushTelemetry, TELEMETRY_FLUSH_MS);
    };

    const unlisteners: Array<Promise<() => void>> = [
      subscribeValidated("benchmark://started", startedEventSchema, (p) =>
        useLiveStore.getState().applyStarted(p),
      ),
      subscribeValidated(
        "benchmark://telemetry",
        telemetryEventSchema,
        scheduleTelemetry,
      ),
      subscribeValidated("benchmark://run_done", runDoneEventSchema, (p) =>
        useLiveStore.getState().applyRunDone(p),
      ),
      subscribeValidated(
        "benchmark://scenario_done",
        scenarioDoneEventSchema,
        (p) => useLiveStore.getState().applyScenarioDone(p),
      ),
      subscribeValidated("benchmark://complete", completeEventSchema, (p) =>
        useLiveStore.getState().applyComplete(p),
      ),
      subscribeValidated("benchmark://cancelled", cancelledEventSchema, () =>
        useLiveStore.getState().applyCancelled(),
      ),
      subscribeValidated("benchmark://error", errorEventSchema, (p) =>
        useLiveStore.getState().applyError(p.error),
      ),
    ];
    return () => {
      unlisteners.forEach((p) => p.then((un) => un()));
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = null;
      pending.clear();
    };
  }, []);
}
