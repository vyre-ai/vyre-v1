// engine.complete: one request and one answer on a chosen account, for work that needs a model but is not a chat (memory upkeep). The account must be one the caller can run on; the answer is the model's
// text and its token counts. Spend is the caller's to meter (memory records it per run against its monthly cap); nothing is posted to any thread.
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import type { ResolvedAccount } from "../../../agent/src/turn-engine/types.ts";
import { ensureRuntime, completerOf, providerOfDriver } from "../runtime.ts";
import { accountsList } from "./accounts.ts";
import { raise } from "../projections.ts";
import type { EngineCtx } from "../projections.ts";

export async function complete(ctx: Ctx, input: { accountRef: string; prompt: string; system?: string; model?: string }) {
  await ensureRuntime(ctx as unknown as EngineCtx);
  const run = completerOf();
  if (!run) raise(ctx as unknown as EngineCtx, "internal.unavailable", "The engine is not running on this host.");
  const list = (await accountsList(ctx, {} as never)) as { accounts: Array<{ ref: string; driver: string; kind: "api_key" | "subscription"; base?: string; keyless?: boolean; itemId?: string }> };
  const row = list.accounts.find((a) => a.ref === input.accountRef);
  if (!row) raise(ctx as unknown as EngineCtx, "validation.not_found", "That account is not one you can run on.", { accountRef: input.accountRef });
  const payer = ctx.actingFor ?? ctx.principal.id;
  const account: ResolvedAccount = {
    ref: row.ref, driver: row.driver, provider: providerOfDriver(row.driver), kind: row.kind, payer, reason: "starter",
    ...(row.itemId ? { itemId: row.itemId } : {}), ...(row.base ? { base: row.base } : {}), ...(row.keyless ? { keyless: true } : {}),
  } as ResolvedAccount;
  const out = await run({ account, prompt: input.prompt, ...(input.system ? { system: input.system } : {}), ...(input.model ? { model: input.model } : {}) });
  return { text: out.text, tokensIn: out.tokensIn, tokensOut: out.tokensOut };
}
