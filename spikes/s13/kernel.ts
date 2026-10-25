// The fast VectorKernel (S13): the SIMD scan assembled from kernel.wat, behind the interface modules/search owns (VectorKernel). A kernel that cannot load (no SIMD in the runtime)
// is reported as null and the caller keeps jsKernel; there is no half-working state.
//
// The scan reads the vectors where they lie. A vector array handed out by `alloc` lives in the kernel's own WebAssembly memory, so scoring it copies nothing (the 60 ms budget over
// 200,000 vectors is about the 300 MB being read once, a copy would double it). Any other array is staged through a small buffer chunk by chunk, so the kernel is correct for every caller
// and fast for the one that allocates from it.
import { assembleKernel } from "./assemble.ts";
import type { VectorKernel } from "../../modules/search/projections.ts";

const DIM = 384;
const VEC_BYTES = DIM * 4;
const PAGE = 65_536;
const Q_OFF = 0;                          // the query: 1,536 bytes
const OUT_OFF = PAGE;                     // scores: up to 16,384 floats
const OUT_MAX = 16_384;
const DATA_OFF = OUT_OFF + OUT_MAX * 4;   // the vectors (or the staging chunk) start here, 16-byte aligned

interface Exports { scan(vec: number, q: number, count: number, out: number): void }
interface Mem { readonly buffer: ArrayBuffer }
interface WasmApi {
  Memory: new (d: { initial: number; maximum?: number }) => Mem;
  Module: new (bytes: Uint8Array) => object;
  Instance: new (m: object, imports: object) => { exports: Record<string, unknown> };
  validate(bytes: Uint8Array): boolean;
}

export interface WasmKernel extends VectorKernel {
  /** A float array of `floats` entries in the kernel's own memory: scoring it needs no copy. Its size is fixed. */
  alloc(floats: number): Float32Array;
  readonly bytes: number;
}

export async function loadWasmKernel(bytes?: Uint8Array): Promise<WasmKernel | null> {
  const api = (globalThis as { WebAssembly?: WasmApi }).WebAssembly;
  if (!api) return null;
  const code = bytes ?? (await assembleKernel());
  if (!api.validate(code)) return null;
  const module = new api.Module(code);
  const pages = (floats: number): number => Math.ceil((DATA_OFF + floats * 4) / PAGE);
  const make = (floats: number): { mem: Mem; scan: Exports["scan"]; f32: Float32Array } => {
    const mem = new api.Memory({ initial: pages(floats) });
    const scan = new api.Instance(module, { e: { m: mem } }).exports["scan"] as Exports["scan"];
    return { mem, scan, f32: new Float32Array(mem.buffer) };
  };
  const owned = new WeakMap<ArrayBuffer, ReturnType<typeof make>>();
  const STAGE = 4_096;
  const stage = make(STAGE * DIM);

  const run = (k: ReturnType<typeof make>, vecByte: number, count: number, q: Float32Array, out: Float32Array): void => {
    k.f32.set(q, Q_OFF / 4);
    for (let done = 0; done < count; done += OUT_MAX) {
      const n = Math.min(OUT_MAX, count - done);
      k.scan(vecByte + done * VEC_BYTES, Q_OFF, n, OUT_OFF);
      out.set(k.f32.subarray(OUT_OFF / 4, OUT_OFF / 4 + n), done);
    }
  };

  return {
    name: "wasm-simd",
    bytes: code.length,
    alloc(floats) {
      const k = make(floats);
      const view = k.f32.subarray(DATA_OFF / 4, DATA_OFF / 4 + floats);
      owned.set(k.mem.buffer, k);
      return view;
    },
    score(data, from, count, q, out) {
      const k = owned.get(data.buffer as ArrayBuffer);
      if (k) { run(k, data.byteOffset + from * 4, count, q, out); return; }
      // not ours: copy the run into the staging area a chunk at a time
      for (let done = 0; done < count; done += STAGE) {
        const n = Math.min(STAGE, count - done);
        stage.f32.set(data.subarray(from + done * DIM, from + (done + n) * DIM), DATA_OFF / 4);
        run(stage, DATA_OFF, n, q, out.subarray(done, done + n));
      }
    },
  };
}
