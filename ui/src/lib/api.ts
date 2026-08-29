import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { pyInvoke } from "tauri-plugin-pytauri-api";

/** Minimal parser interface: satisfied by zod schemas. */
export interface Parser<T> {
  parse: (data: unknown) => T;
}

const RETRYABLE = "too frequently";
const RETRY_DELAY_MS = 150;
const MAX_RETRIES = 2;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Typed, validated IPC call. Every response body is parsed with the
 * provided schema before it reaches the caller, so malformed payloads
 * are rejected at the boundary.
 *
 * Rate-limiter rejections are retried with a short backoff: React
 * StrictMode double-invokes effects in dev, which would otherwise turn
 * benign duplicate calls into user-visible errors.
 */
export async function pyInvokeValidated<T>(
  cmd: string,
  schema: Parser<T>,
  body?: unknown,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      const raw = await pyInvoke<unknown>(cmd, body);
      return schema.parse(raw);
    } catch (err) {
      if (attempt < MAX_RETRIES && String(err).includes(RETRYABLE)) {
        await sleep(RETRY_DELAY_MS);
        continue;
      }
      throw err;
    }
  }
}

/**
 * Validated event subscription: registers a tauri listener and parses the
 * payload with the given schema before invoking the callback.
 */
export async function subscribeValidated<T>(
  event: string,
  schema: Parser<T>,
  cb: (payload: T) => void,
): Promise<UnlistenFn> {
  return listen<unknown>(event, (e) => {
    try {
      cb(schema.parse(e.payload));
    } catch {
      // drop malformed payloads rather than crashing the view
    }
  });
}

export { pyInvoke };
