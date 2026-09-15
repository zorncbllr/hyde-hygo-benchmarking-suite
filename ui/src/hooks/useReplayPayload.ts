import { useEffect, useState } from "react";
import { pyInvokeValidated } from "@/lib/api";
import { scenarioPayloadSchema, type ScenarioPayload } from "@/lib/schemas";

// Module-level caches: survive StrictMode remounts and view switches.
const cache = new Map<string, ScenarioPayload>();
const inFlight = new Map<string, Promise<ScenarioPayload>>();

function fetchReplayPayload(
  key: string,
  runId: string,
  payloadPath: string,
): Promise<ScenarioPayload> {
  const existing = inFlight.get(key);
  if (existing) return existing;
  const promise = pyInvokeValidated("get_payload", scenarioPayloadSchema, {
    run_id: runId,
    payload_path: payloadPath,
  })
    .then((payload) => {
      cache.set(key, payload);
      inFlight.delete(key);
      return payload;
    })
    .catch((err) => {
      inFlight.delete(key);
      throw err;
    });
  inFlight.set(key, promise);
  return promise;
}

/**
 * Loads the full per-algorithm payload (including replay_histories) for the
 * 3D replay tab, lazily and deduplicated across concurrent requests and
 * StrictMode double-fires. The results page's batched read excludes these
 * heavy fields (see SLIM_EXCLUDED_KEYS on the backend), so they are fetched
 * here only when the replay tab is actually open.
 */
export function useReplayPayload(
  runId: string,
  payloadPath: string | null,
): {
  payload: ScenarioPayload | null;
  loading: boolean;
  error: string | null;
} {
  const key = payloadPath ? `${runId}:${payloadPath}` : null;
  const [payload, setPayload] = useState<ScenarioPayload | null>(
    key ? (cache.get(key) ?? null) : null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const cached = key ? cache.get(key) : undefined;
    if (cached || !payloadPath || !key) {
      setPayload(cached ?? null);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    fetchReplayPayload(key, runId, payloadPath)
      .then((p) => {
        if (!cancelled) {
          setPayload(p);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setPayload(null);
          setLoading(false);
          setError(String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [key, payloadPath, runId]);

  return { payload, loading, error };
}
