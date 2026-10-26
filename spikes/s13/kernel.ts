// The fast vector store (S13): int8 vectors with a per-vector scale, scanned by the SIMD kernel assembled from kernel.wat, the best candidates reranked exactly with the float32 vectors.
//   store    each unit vector is kept twice: as 384 int8 (scale = max |x| / 127) in WebAssembly memory for the scan, and as float32 for the rerank (the float copy is not scanned)
//   top      the query is quantized to int16; the kernel writes one int32 dot per vector; score = dot * vectorScale * queryScale; the best `candidates` (200) are kept;
//            those are scored exactly in float32 and the best k returned. Int8 error is about 0.4 percent per component, so the exact top 20 sit inside the top 200 with a wide margin.
// A runtime without SIMD gives `null` from loadWasmKernel and the caller keeps jsKernel.
import { assembleKernel } from "./assemble.ts";
import { jsKernel } from "../../modules/search/projections.ts";
import type { VectorKernel, VectorStore } from "../../modules/search/projections.ts";

const DIM = 384;
const PAGE = 65_536;
const Q_OFF = 0;                          // the query as int16: 768 bytes
const OUT_OFF = PAGE;                     // int32 dots for one chunk
const CHUNK = 16_384;
const DATA_OFF = OUT_OFF + CHUNK * 4;     // the int8 vectors

/** How many candidates the int8 scan keeps for the exact rerank. */
export const CANDIDATES = 200;

interface Mem { readonly buffer: ArrayBuffer }
interface WasmApi {
  Memory: new (d: { initial: number }) => Mem;
  Module: new (bytes: Uint8Array) => object;
  Instance: new (m: object, imports: object) => { exports: Record<string, unknown> };
  validate(bytes: Uint8Array): boolean;
}
type Dot8 = (vec: number, q: number, count: number, out: number) => void;

export interface WasmKernel extends VectorKernel {
  readonly bytes: number;
  store(capacity: number): VectorStore;
}

export async function loadWasmKernel(bytes?: Uint8Array): Promise<WasmKernel | null> {
  const api = (globalThis as { WebAssembly?: WasmApi }).WebAssembly;
  if (!api) return null;
  const code = bytes ?? (await assembleKernel());
  if (!api.validate(code)) return null;
  const module = new api.Module(code);

  function store(capacity: number): VectorStore {
    let cap = 0;
    let mem!: Mem;
    let dot8!: Dot8;
    let i8!: Int8Array;
    let i16!: Int16Array;
    let i32!: Int32Array;
    let scale = new Float32Array(0);
    let exact = new Float32Array(0);
    const open = (c: number): void => {
      const pages = Math.ceil((DATA_OFF + c * DIM) / PAGE);
      const m = new api!.Memory({ initial: pages });
      const inst = new api!.Instance(module, { e: { m } });
      const next = new Int8Array(m.buffer, DATA_OFF, c * DIM);
      if (cap > 0) next.set(i8.subarray(0, cap * DIM));
      mem = m; dot8 = inst.exports["dot8"] as Dot8; i8 = next;
      i16 = new Int16Array(m.buffer, Q_OFF, DIM);
      i32 = new Int32Array(m.buffer, OUT_OFF, CHUNK);
      const s = new Float32Array(c); s.set(scale.subarray(0, Math.min(scale.length, c))); scale = s;
      const e = new Float32Array(c * DIM); e.set(exact.subarray(0, Math.min(exact.length, c * DIM))); exact = e;
      cap = c;
    };
    open(Math.max(1, capacity));
    void mem;

    const bestOf = (cs: Float64Array, ci: Int32Array, n: number, keep: number): number => {
      // order the n candidates by score, best first, keep `keep`; returns how many are kept
      const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => cs[b]! - cs[a]!);
      const m = Math.min(keep, n);
      const ns = new Float64Array(m), ni = new Int32Array(m);
      for (let i = 0; i < m; i++) { ns[i] = cs[order[i]!]!; ni[i] = ci[order[i]!]!; }
      cs.set(ns); ci.set(ni);
      return m;
    };

    return {
      reserve(c) { if (c > cap) open(c); },
      set(slot, v) {
        let max = 0;
        for (let i = 0; i < DIM; i++) { const a = Math.abs(v[i]!); if (a > max) max = a; }
        const sc = max === 0 ? 1 : max / 127;
        const inv = 1 / sc;
        const o = slot * DIM;
        for (let i = 0; i < DIM; i++) i8[o + i] = Math.round(v[i]! * inv);
        scale[slot] = sc;
        exact.set(v, o);
      },
      move(to, from) {
        i8.copyWithin(to * DIM, from * DIM, (from + 1) * DIM);
        scale[to] = scale[from]!;
        exact.copyWithin(to * DIM, from * DIM, (from + 1) * DIM);
      },
      top(q, count, k, accept) {
        if (count === 0) return [];
        const want = Math.max(CANDIDATES, k * 10);
        let qmax = 0;
        for (let i = 0; i < DIM; i++) { const a = Math.abs(q[i]!); if (a > qmax) qmax = a; }
        const qs = qmax === 0 ? 1 : qmax / 32767;
        const qinv = 1 / qs;
        for (let i = 0; i < DIM; i++) i16[i] = Math.round(q[i]! * qinv);
        const cs = new Float64Array(want * 4), ci = new Int32Array(want * 4);
        let n = 0;
        let floor = -Infinity;
        for (let start = 0; start < count; start += CHUNK) {
          const m = Math.min(CHUNK, count - start);
          dot8(DATA_OFF + start * DIM, Q_OFF, m, OUT_OFF);
          for (let i = 0; i < m; i++) {
            const score = i32[i]! * scale[start + i]! * qs;
            if (score <= floor) continue;
            if (accept && !accept(start + i)) continue;
            cs[n] = score; ci[n] = start + i; n++;
            if (n === cs.length) { n = bestOf(cs, ci, n, want); floor = cs[n - 1]!; }
          }
        }
        n = bestOf(cs, ci, n, want);
        // exact rerank of the candidates with the float32 vectors
        const out: Array<{ slot: number; score: number }> = [];
        for (let c = 0; c < n; c++) {
          const slot = ci[c]!;
          const o = slot * DIM;
          let a0 = 0, a1 = 0, a2 = 0, a3 = 0;
          for (let i = 0; i < DIM; i += 4) { a0 += exact[o + i]! * q[i]!; a1 += exact[o + i + 1]! * q[i + 1]!; a2 += exact[o + i + 2]! * q[i + 2]!; a3 += exact[o + i + 3]! * q[i + 3]!; }
          out.push({ slot, score: (a0 + a1) + (a2 + a3) });
        }
        out.sort((a, b) => b.score - a.score);
        return out.slice(0, k);
      },
    };
  }

  return { name: "wasm-int8", bytes: code.length, score: jsKernel.score, store };
}
