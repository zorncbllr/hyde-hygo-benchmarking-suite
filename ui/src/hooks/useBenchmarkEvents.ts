import { useEffect } from "react";
import { useLiveStore } from "@/stores/live";
import { subscribeValidated } from "@/lib/api";
import {
  cancelledEventSchema,
  completeEventSchema,
  errorEventSchema,
  runDoneEventSchema,
  scenarioDoneEventSchema,
  startedEventSchema,
  telemetryEventSchema,
} from "@/lib/schemas";

import { activeRunResponseSchema } from "@/lib/schemas";
import { pyInvokeValidated } from "@/lib/api";

/** Subscribes the mounted component to all benchmark events. */
export function useBenchmarkEvents() {
  const store = useLiveStore();

  useEffect(() => {
    // Late mounts miss events emitted before subscription; sync once.
    pyInvokeValidated("get_active_run", activeRunResponseSchema)
      .then((snap) => useLiveStore.getState().syncActive(snap))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const unlisteners: Array<Promise<() => void>> = [
      subscribeValidated("benchmark://started", startedEventSchema, (p) =>
        store.applyStarted(p),
      ),
      subscribeValidated("benchmark://telemetry", telemetryEventSchema, (p) =>
        store.applyTelemetry(p),
      ),
      subscribeValidated("benchmark://run_done", runDoneEventSchema, (p) =>
        store.applyRunDone(p),
      ),
      subscribeValidated(
        "benchmark://scenario_done",
        scenarioDoneEventSchema,
        (p) => store.applyScenarioDone(p),
      ),
      subscribeValidated("benchmark://complete", completeEventSchema, (p) =>
        store.applyComplete(p),
      ),
      subscribeValidated("benchmark://cancelled", cancelledEventSchema, () =>
        store.applyCancelled(),
      ),
      subscribeValidated("benchmark://error", errorEventSchema, (p) =>
        store.applyError(p.error),
      ),
    ];
    return () => {
      unlisteners.forEach((p) => p.then((un) => un()));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
