// memory.meaning.status: whether meaning search is on and, when it is not, why in plain words.
import { MEANING_MIN, calibrated, cosine, indexedCount, meaningStatus } from "../meaning.ts";
import { ensure } from "../projections.ts";
import type { MemCtx } from "../projections.ts";

/** Rank texts the caller already holds against a question, by meaning. A score is 0 for unrelated and 0.5 to 1 for related (see `calibrated`). Nothing is stored: the texts are embedded for this call and dropped, so it is safe for private chats. */
export async function meaningRank(ctx: MemCtx, input: { query: string; candidates: Array<{ id: string; text: string }> }) {
  ensure(ctx.db);
  const { embedder, ...status } = await meaningStatus(ctx);
  const info = { state: status.state, ...(status.model ? { model: status.model } : {}), ...(status.hint ? { hint: status.hint } : {}) };
  if (!embedder || input.candidates.length === 0) return { scores: [] as Array<{ id: string; score: number }>, meaning: info };
  try {
    const live = input.candidates.slice(0, 200);
    const [q, ...vs] = await embedder.embed([input.query, ...live.map((c) => c.text)]);
    if (!q) return { scores: [], meaning: { ...info, state: "degraded" as const, hint: "Meaning search returned nothing. Keyword search is in use." } };
    return { scores: live.map((c, i) => ({ id: c.id, score: Math.round((vs[i] ? calibrated(cosine(q, vs[i]!), embedder.minScore ?? MEANING_MIN) : 0) * 10_000) / 10_000 })), meaning: info };
  } catch {
    return { scores: [], meaning: { ...info, state: "degraded" as const, hint: "Meaning search could not run just now. Keyword search is in use." } };
  }
}

export async function meaningStatusRead(ctx: MemCtx) {
  ensure(ctx.db);
  const { embedder: _e, ...s } = await meaningStatus(ctx);
  return { ...s, indexed: indexedCount(ctx, s.model) };
}
