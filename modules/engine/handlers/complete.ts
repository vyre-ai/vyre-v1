// engine.complete (internal: refused at depth 0): one request and one answer on a chosen account, for work that needs a model but is not a chat (memory upkeep). The account must be one the caller can run on; the answer is the model's
// text and its token counts. Spend is the caller's to meter (memory records it per run against its monthly cap); nothing is posted to any thread.
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import type { ResolvedAccount } from "../../../agent/src/turn-engine/types.ts";
import { ensureRuntime, completerOf, providerOfDriver } from "../runtime.ts";
import { accountsList } from "./accounts.ts";
import { turnsRunHere } from "./place.ts";
import { raise } from "../projections.ts";
import type { EngineCtx } from "../projections.ts";

/** How long a one-shot on the person's computer may take before the pass is given up (the learning it serves is background work). */
export const DEVICE_ONESHOT_MS = 90_000;

export async function complete(ctx: Ctx, input: { accountRef: string; prompt: string; system?: string; model?: string }) {
  // Internal only: a model request on someone's account is made by a module on behalf of a key it resolved, never by a person, an agent tool or MCP, which all arrive at depth 0.
  if (!(ctx.depth >= 1)) raise(ctx as unknown as EngineCtx, "permission.no_grant", "This is called by the Space's own jobs, not directly.");
  await ensureRuntime(ctx as unknown as EngineCtx);
  const run = completerOf();
  if (!run) raise(ctx as unknown as EngineCtx, "internal.unavailable", "The engine is not running on this host.");
  const list = (await accountsList(ctx, {} as never)) as { accounts: Array<{ ref: string; driver: string; kind: "api_key" | "subscription"; base?: string; keyless?: boolean; itemId?: string }> };
  const row = list.accounts.find((a) => a.ref === input.accountRef);
  if (!row) raise(ctx as unknown as EngineCtx, "validation.not_found", "That account is not one you can run on.", { accountRef: input.accountRef });
  // a CLI engine's request needs an engine process: where this person's chats run it starts there (their own computer through its link), an API key's request stays here on their own key
  const here = await turnsRunHere((cap, i) => ctx.call(cap, i), ctx.actingFor ?? ctx.principal.id, ctx.now(), row.driver);
  const payer = ctx.actingFor ?? ctx.principal.id;
  const account: ResolvedAccount = {
    ref: row.ref, driver: row.driver, provider: providerOfDriver(row.driver), kind: row.kind, payer, reason: "starter",
    ...(row.itemId ? { itemId: row.itemId } : {}), ...(row.base ? { base: row.base } : {}), ...(row.keyless ? { keyless: true } : {}),
  } as ResolvedAccount;
  // a pass that waits on a computer must not wait for ever: the learning it serves is background work and is skipped when the computer does not answer
  const call = run({ account, prompt: input.prompt, ...(here ? {} : { onDevice: true }), ...(input.system ? { system: input.system } : {}), ...(input.model ? { model: input.model } : {}) });
  const out = here ? await call : await Promise.race([call, new Promise<never>((_, rej) => { const t = setTimeout(() => rej(Object.assign(new Error("The computer did not answer in time."), { code: "engine.device_off" })), DEVICE_ONESHOT_MS); t.unref?.(); })]);
  return { text: out.text, tokensIn: out.tokensIn, tokensOut: out.tokensOut };
}
