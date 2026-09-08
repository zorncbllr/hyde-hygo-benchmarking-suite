import type { SimulationTrace } from "@/lib/schemas";
import type { DecodedTrace } from "@/lib/simulation";

/**
 * Inflates the backend's packed event streams. The backend delta-encodes
 * each stream as int16, zlib-compresses (RFC1950 "deflate") and
 * base64-encodes it; see suite.simulation for the packing side.
 */

/** The loaded trace as consumed by the player: schema data + decoded events. */
export type SimulationTraceLoaded = SimulationTrace & {
  decoded: DecodedTrace;
};

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

async function inflateDeflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = bytesToStream(bytes).pipeThrough(
    new DecompressionStream("deflate"),
  );
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function deltaDecodeI16(bytes: Uint8Array, out: Int32Array): void {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let acc = 0;
  for (let i = 0; i < out.length; i++) {
    acc += dv.getInt16(i * 2, true);
    out[i] = acc;
  }
}

/** Decodes the four packed event streams into typed arrays. */
export async function decodeTracePayload(
  trace: SimulationTrace,
): Promise<SimulationTraceLoaded> {
  const n = trace.n_events;
  const p = trace.events_payload;

  const [funcB, lineB, evalB, beatB] = await Promise.all([
    inflateDeflate(b64ToBytes(p.func)),
    inflateDeflate(b64ToBytes(p.line)),
    inflateDeflate(b64ToBytes(p.eval_count)),
    inflateDeflate(b64ToBytes(p.beat)),
  ]);

  const funcIdx = new Int32Array(n);
  const linenos = new Int32Array(n);
  const evalCounts = new Int32Array(n);
  const beatIdxs = new Int32Array(n);
  deltaDecodeI16(funcB, funcIdx);
  deltaDecodeI16(lineB, linenos);
  deltaDecodeI16(evalB, evalCounts);
  deltaDecodeI16(beatB, beatIdxs);

  return {
    ...trace,
    decoded: { n, funcIdx, linenos, evalCounts, beatIdxs },
  };
}
