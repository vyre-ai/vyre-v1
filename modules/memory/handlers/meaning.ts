// memory.meaning.status: whether meaning search is on and, when it is not, why in plain words.
import { indexedCount, meaningStatus } from "../meaning.ts";
import { ensure } from "../projections.ts";
import type { MemCtx } from "../projections.ts";

export async function meaningStatusRead(ctx: MemCtx) {
  ensure(ctx.db);
  const { embedder: _e, ...s } = await meaningStatus(ctx);
  return { ...s, indexed: indexedCount(ctx, s.model) };
}
