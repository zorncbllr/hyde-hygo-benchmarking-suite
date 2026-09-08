import { pyInvokeValidated } from "@/lib/api";
import {
  decodeTracePayload,
  type SimulationTraceLoaded,
} from "@/lib/simTraceCodec";
import { simulationTraceSchema, type SimulationRequest } from "@/lib/schemas";

// Module-level trace cache: deduplicates StrictMode double-fires, makes
// algorithm-tab switches instant, and bounds memory to the last few traces.
const TRACE_CACHE = new Map<string, Promise<SimulationTraceLoaded>>();
const TRACE_CACHE_MAX = 12;

/** Hard cap so a stuck IPC call surfaces as an error, not an eternal spinner. */
const TRACE_TIMEOUT_MS = 30_000;

function traceCacheKey(req: SimulationRequest): string {
  return [req.algo_key, req.fname, req.seed, req.max_evals, req.pop_size].join(
    "|",
  );
}

export function fetchTrace(
  req: SimulationRequest,
): Promise<SimulationTraceLoaded> {
  const key = traceCacheKey(req);
  const cached = TRACE_CACHE.get(key);
  if (cached) return cached;
  const promise = Promise.race([
    pyInvokeValidated("run_simulation", simulationTraceSchema, req).then(
      decodeTracePayload,
    ),
    new Promise<SimulationTraceLoaded>((_, reject) =>
      setTimeout(
        () => reject(new Error("simulation timed out")),
        TRACE_TIMEOUT_MS,
      ),
    ),
  ]).catch((err) => {
    TRACE_CACHE.delete(key);
    throw err;
  });
  TRACE_CACHE.set(key, promise);
  if (TRACE_CACHE.size > TRACE_CACHE_MAX) {
    const oldest = TRACE_CACHE.keys().next().value;
    if (oldest !== undefined) TRACE_CACHE.delete(oldest);
  }
  return promise;
}

/** Test isolation hook (mirrors suite.ratelimit.reset_for_tests). */
export function resetTraceCacheForTests(): void {
  TRACE_CACHE.clear();
}
