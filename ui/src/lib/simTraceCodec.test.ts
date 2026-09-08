import { describe, expect, it } from "vitest";
import { decodeTracePayload } from "@/lib/simTraceCodec";
import { simulationTraceSchema } from "@/lib/schemas";

/**
 * Packs int streams exactly like the backend (suite.simulation._pack_i16_delta):
 * int16 deltas, zlib deflate (RFC1950), base64.
 */
async function pack(values: number[]): Promise<string> {
  const deltas = new Int16Array(values.length);
  let prev = 0;
  for (let i = 0; i < values.length; i++) {
    deltas[i] = values[i] - prev;
    prev = values[i];
  }
  const bytes = new Uint8Array(
    deltas.buffer,
    deltas.byteOffset,
    deltas.byteLength,
  );
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  }).pipeThrough(new CompressionStream("deflate"));
  const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
  let bin = "";
  for (const b of compressed) bin += String.fromCharCode(b);
  return btoa(bin);
}

describe("decodeTracePayload", () => {
  it("roundtrips packed int16-delta streams into typed arrays", async () => {
    const func = [0, 0, 1, 1, 2, 0];
    const line = [4, 5, 6, 10, 11, 3];
    const evalCount = [0, 1, 1, 3, 5, 6];
    const beat = [-1, 0, 0, 1, 1, -1];
    const n = func.length;

    const trace = simulationTraceSchema.parse({
      algo_key: "hyde_bin",
      fname: "sphere",
      dim: 2,
      seed: 0,
      max_evals: 400,
      pop_size: 24,
      lo: [-5, -5],
      hi: [5, 5],
      source: "class A:\n    pass\n",
      func_names: ["run", "f"],
      n_events: n,
      events_payload: {
        func: await pack(func),
        line: await pack(line),
        eval_count: await pack(evalCount),
        beat: await pack(beat),
      },
      beats: [
        { phase: "de", title: "t", body: "b", start_line: 1, end_line: 8 },
      ],
      snapshots: [],
      result: { best_cost: 1, best_x: [0, 0], evals: 6, conv_gen: null },
      truncated: false,
    });

    const loaded = await decodeTracePayload(trace);
    const d = loaded.decoded;
    expect(d.n).toBe(n);
    expect(Array.from(d.funcIdx)).toEqual(func);
    expect(Array.from(d.linenos)).toEqual(line);
    expect(Array.from(d.evalCounts)).toEqual(evalCount);
    expect(Array.from(d.beatIdxs)).toEqual(beat);
    // the loaded trace carries everything else untouched
    expect(loaded.source).toBe(trace.source);
    expect(loaded.beats).toEqual(trace.beats);
  });

  it("handles larger monotonic streams (eval counts)", async () => {
    const evalCount = Array.from({ length: 1000 }, (_, i) => Math.floor(i / 3));
    const trace = simulationTraceSchema.parse({
      algo_key: "hygo",
      fname: "sphere",
      dim: 2,
      seed: 0,
      max_evals: 1000,
      pop_size: 24,
      lo: [-5, -5],
      hi: [5, 5],
      source: "x = 1\n",
      func_names: ["run"],
      n_events: evalCount.length,
      events_payload: {
        func: await pack(Array(evalCount.length).fill(0)),
        line: await pack(Array(evalCount.length).fill(1)),
        eval_count: await pack(evalCount),
        beat: await pack(Array(evalCount.length).fill(-1)),
      },
      beats: [],
      snapshots: [],
      result: { best_cost: 1, best_x: null, evals: 333, conv_gen: null },
      truncated: false,
    });
    const loaded = await decodeTracePayload(trace);
    expect(Array.from(loaded.decoded.evalCounts)).toEqual(evalCount);
  });
});
