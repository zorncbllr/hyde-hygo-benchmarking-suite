import { useEffect, useState } from "react";
import { pyInvokeValidated } from "@/lib/api";
import { surfaceResponseSchema, type SurfaceResponse } from "@/lib/schemas";

// Module-level caches: survive StrictMode remounts and view switches.
const cache = new Map<string, SurfaceResponse>();
const inFlight = new Map<string, Promise<SurfaceResponse>>();

function fetchSurface(fname: string): Promise<SurfaceResponse> {
  const existing = inFlight.get(fname);
  if (existing) return existing;
  const promise = pyInvokeValidated("get_surface", surfaceResponseSchema, {
    fname,
  })
    .then((surface) => {
      cache.set(fname, surface);
      inFlight.delete(fname);
      return surface;
    })
    .catch((err) => {
      inFlight.delete(fname);
      throw err;
    });
  inFlight.set(fname, promise);
  return promise;
}

export function isCached(fname: string): boolean {
  return cache.has(fname);
}

/**
 * Loads a 2D benchmark surface mesh, deduplicating concurrent requests
 * (StrictMode double-fires effects) and retrying once when the backend
 * rate limiter throttles the call.
 */
export function useSurface(fname: string): {
  surface: SurfaceResponse | null;
  error: string | null;
} {
  const [surface, setSurface] = useState<SurfaceResponse | null>(
    cache.get(fname) ?? null,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const cached = cache.get(fname);
    if (cached) {
      setSurface(cached);
      setError(null);
      return;
    }
    setSurface(null);

    const load = (retry: boolean): void => {
      fetchSurface(fname)
        .then((s) => {
          if (!cancelled) {
            setSurface(s);
            setError(null);
          }
        })
        .catch((err) => {
          if (cancelled) return;
          const throttled = String(err).includes("too frequently");
          if (throttled && retry) {
            setTimeout(() => {
              if (!cancelled) load(false);
            }, 200);
            return;
          }
          setError(String(err));
        });
    };
    load(true);

    return () => {
      cancelled = true;
    };
  }, [fname]);

  return { surface, error };
}
