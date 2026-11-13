// engine.complete (internal: refused at depth 0): one request and one answer on a chosen account, for work that needs a model but is not a chat (memory upkeep). The account must be one the caller can run on; the answer is the model's
// text and its token counts. Spend is the caller's to meter (memory records it per run against its monthly cap); nothing is posted to any thread.
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import type { ResolvedAccount } from "../../../agent/src/turn-engine/types.ts";
import { ensureRuntime, completerOf, providerOfDriver } from "../runtime.ts";
import { accountsList } from "./accounts.ts";
import {
  PROVIDER_DEFAULT_DRIVERS,
  PROVIDER_DEFAULT_WORDS,
  providerDefaultBlocked,
  readPolicy,
} from "./extra/config.ts";
import { turnsRunHere } from "./place.ts";
import { defaultModelFor } from "../first-model.ts";
import { raise } from "../projections.ts";
import type { EngineCtx } from "../projections.ts";

/** How long a one-shot on the person's computer may take before the pass is given up (the learning it serves is background work). */
export const DEVICE_ONESHOT_MS = 90_000;

export async function complete(
  ctx: Ctx,
  input: { accountRef: string; prompt: string; system?: string; model?: string },
) {
  // Internal only: a model request on someone's account is made by a module on behalf of a key it resolved, never by a person, an agent tool or MCP, which all arrive at depth 0.
  if (!(ctx.depth >= 1) || ctx.forwarded === true)
    raise(ctx as unknown as EngineCtx, "permission.no_grant", "This is called by the Space's own jobs, not directly.");
  await ensureRuntime(ctx as unknown as EngineCtx);
  const run = completerOf();
  if (!run) raise(ctx as unknown as EngineCtx, "internal.unavailable", "The engine is not running on this host.");
  const list = (await accountsList(ctx, {} as never)) as {
    accounts: Array<{
      ref: string;
      driver: string;
      kind: "api_key" | "subscription";
      base?: string;
      keyless?: boolean;
      itemId?: string;
      models?: string[];
    }>;
  };
  const row = list.accounts.find((a) => a.ref === input.accountRef);
  if (!row)
    raise(ctx as unknown as EngineCtx, "validation.not_found", "That account is not one you can run on.", {
      accountRef: input.accountRef,
    });
  // a CLI engine's request needs an engine process: where this person's chats run it starts there (their own computer through its link), an API key's request stays here on their own key
  const here = await turnsRunHere(
    (cap, i) => ctx.call(cap, i),
    ctx.actingFor ?? ctx.principal.id,
    ctx.now(),
    row.driver,
  );
  const payer = ctx.actingFor ?? ctx.principal.id;
  const account: ResolvedAccount = {
    ref: row.ref,
    driver: row.driver,
    provider: providerOfDriver(row.driver),
    kind: row.kind,
    payer,
    reason: "starter",
    ...(row.itemId ? { itemId: row.itemId } : {}),
    ...(row.base ? { base: row.base } : {}),
    ...(row.keyless ? { keyless: true } : {}),
  } as ResolvedAccount;
  // a pass that waits on a computer must not wait for ever: the learning it serves is background work and is skipped when the computer does not answer
  // a job that names no model on a person's API key: the default nobody chose, from the key's own list (first-model.ts; one rule with chat and the step)
  let jobModel = input.model;
  if (!jobModel) {
    const pol = await readPolicy(ctx as unknown as EngineCtx);
    const d = await defaultModelFor(
      {
        db: (ctx as unknown as EngineCtx).db as never,
        now: ctx.now(),
        call: (cap, i) => ctx.call(cap as never, i as never),
        policy: pol,
      },
      { ref: row.ref, driver: row.driver, provider: providerOfDriver(row.driver), kind: row.kind, models: row.models },
    );
    if (d.why === "policy")
      raise(ctx as unknown as EngineCtx, "permission.provider_label", PROVIDER_DEFAULT_WORDS, {
        reason: "policy_model",
      });
    jobModel = d.model;
  }
  // a job that names no model on a provider that runs its own default (OpenRouter): the Space policy is checked first, before anything is sent (one rule: config.ts providerDefaultBlocked)
  if (!jobModel && PROVIDER_DEFAULT_DRIVERS.has(row.driver)) {
    const why = providerDefaultBlocked(await readPolicy(ctx as unknown as EngineCtx), row.driver);
    if (why !== null)
      raise(ctx as unknown as EngineCtx, "permission.provider_label", PROVIDER_DEFAULT_WORDS, { reason: why });
  }
  const call = run({
    account,
    prompt: input.prompt,
    ...(here ? {} : { onDevice: true }),
    ...(input.system ? { system: input.system } : {}),
    ...(jobModel ? { model: jobModel } : {}),
  });
  const out = here
    ? await call
    : await Promise.race([
        call,
        new Promise<never>((_, rej) => {
          const t = setTimeout(
            () => rej(Object.assign(new Error("The computer did not answer in time."), { code: "engine.device_off" })),
            DEVICE_ONESHOT_MS,
          );
          t.unref?.();
        }),
      ]);
  return { text: out.text, tokensIn: out.tokensIn, tokensOut: out.tokensOut };
}
