// A stand-in embedding model for tests: each word belongs to a concept, and a text's vector is the unit vector of the concepts it touches. Two texts about one concept are close with no word in common,
// which is what a real model gives and what the keyword and trigram scores cannot.
import type { Embedder, EmbedderState } from "../meaning.ts";

export const CONCEPTS: Record<string, string[]> = {
  bank: ["bank", "banking", "reconciliation", "reconcile", "chase", "feed", "statement", "ledger", "transactions", "deposit", "wire"],
  hiring: ["hire", "hiring", "recruit", "candidate", "interview", "resume", "applicant"],
  weather: ["rain", "storm", "forecast", "sunny", "weather"],
  coffee: ["coffee", "espresso", "latte", "tea", "oat"],
};
const DIM = Object.keys(CONCEPTS).length;

export function conceptVector(text: string): Float32Array {
  const words = text.toLowerCase().split(/[^a-z]+/);
  const v = new Float32Array(DIM);
  Object.values(CONCEPTS).forEach((list, i) => { v[i] = words.filter((w) => list.includes(w)).length; });
  const norm = Math.hypot(...v);
  if (norm > 0) for (let i = 0; i < DIM; i++) v[i]! /= norm;
  return v;
}

export interface StubEmbedder extends Embedder { calls: string[][]; state: EmbedderState; detail: string | undefined; fail: boolean }

export function stubEmbedder(name = "stub-concepts-v1"): StubEmbedder {
  const e: StubEmbedder = {
    name, dim: DIM, calls: [], state: "ready", detail: undefined, fail: false,
    status() { return { state: e.state, ...(e.detail ? { detail: e.detail } : {}) }; },
    async embed(texts) {
      if (e.state !== "ready") throw new Error("not ready");
      if (e.fail) throw new Error("the model fell over");
      e.calls.push([...texts]);
      return texts.map(conceptVector);
    },
  };
  return e;
}
