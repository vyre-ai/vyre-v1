// A turn whose model the engine said is not there (engine.model_unavailable, agent/src/drivers/cli/errors.ts) runs again at once on the next best model (owner ruling, 4 Nov 2026): the same provider, then
// the person's last other pick, then the Space's default. The chat says so in one quiet line, the failed model leaves that account's list (model-health.ts), and the model that answered becomes the person's
// last pick so the next chat does not fail the same way. When no model works, the turn ends with engine.no_model_works, which the chat draws as one plain card.
import type { ModelQuery, ResolvedAccount, AccountQuery } from "../../agent/src/turn-engine/types.ts";
import { goneModel } from "../../agent/src/drivers/cli/errors.ts";
import { chatSettings, noteSwap } from "./chat-settings.ts";
import { BRIDGE_PREFIX } from "./handlers/bridge.ts";
import type { PostAs } from "./handlers/bridge.ts";
import { markUnavailable } from "./model-health.ts";
import { modelName } from "./model-fallback.ts";
import { recentPicks } from "./last-pick.ts";
import { mintId } from "./projections.ts";
import type { Db } from "./projections.ts";

type Call = (cap: string, input: unknown, as?: string) => Promise<unknown>;
interface Row { provider: string; model: string; title?: string; allowed: boolean; isDefault?: boolean }

/** The code of a turn that found no model to run. */
export const NO_MODEL_WORKS = "engine.no_model_works";
export const NO_MODEL_WORDS = "None of your AI accounts can answer right now.";

/** The quiet line for a swap. */
export function modelSwapLine(from: string, to: string): string {
  return `${from} isn't available on this account, so this reply used ${to}.`;
}

export interface ModelSwitchDeps {
  call: Call;
  db: Db;
  /** engine.account.resolve for the chat as it stands now (the new pick included). */
  accountFor(q: AccountQuery): Promise<ResolvedAccount | null>;
  postAs?: PostAs;
  now: () => number;
  log?: (msg: string, attrs?: Record<string, unknown>) => void;
}

/** The order to try: the same provider as the failed model, then the person's last other picks (the last three distinct models), then the Space default, then whatever else works. */
export function candidates(rows: readonly Row[], failed: { model: string; provider: string | undefined }, lastPicks: readonly string[]): Row[] {
  const ok = rows.filter((r) => r.allowed && r.model !== failed.model && r.model !== "auto");
  const out: Row[] = [];
  const add = (r: Row | undefined): void => { if (r && !out.includes(r)) out.push(r); };
  const same = ok.filter((r) => r.provider === failed.provider);
  add(same.find((r) => r.isDefault) ?? same[0]);
  for (const r of same) add(r);
  for (const m of lastPicks) if (m !== failed.model) add(ok.find((r) => r.model === m));
  add(ok.find((r) => r.isDefault));
  for (const r of ok) add(r);
  return out;
}

export function createModelSwitch(d: ModelSwitchDeps): (q: ModelQuery) => Promise<ResolvedAccount | null> {
  return async (q) => {
    const settings = await chatSettings(d.call, q.threadId, q.agentId, q.askerId);
    const failedId = settings.model ?? goneModel(q.message);
    if (failedId === undefined || failedId === null) { d.log?.("engine: a model swap found no model to replace", { threadId: q.threadId }); return null; }
    let rows: Row[] = [];
    try { rows = ((await d.call("engine.models.list", { threadId: q.threadId }, q.askerId)) as { models?: Row[] }).models ?? []; }
    catch (e) { d.log?.("the model list could not be read for a model swap", { threadId: q.threadId, error: e instanceof Error ? e.message : String(e) }); }
    const was = rows.find((r) => r.model === failedId);
    // the model leaves this account's list straight away; it is tried again later (model-health.ts)
    markUnavailable(d.db, q.account.ref, failedId, d.now());
    const last = recentPicks(d.db, q.askerId);
    for (const c of candidates(rows, { model: failedId, provider: was?.provider ?? settings.provider }, last)) {
      try {
        // the pick moves to the model that answers: the chat uses it, and so does the person's next new chat
        await d.call("engine.set_model", { threadId: q.threadId, agentId: q.agentId, model: c.model, provider: c.provider }, q.askerId);
        noteSwap(q.threadId, q.agentId, was?.model ?? settings.model, c.model);
        const account = await d.accountFor({ threadId: q.threadId, agentId: q.agentId, askerId: q.askerId });
        if (!account) continue;
        await say(q, modelSwapLine(was?.title ?? modelName(failedId), c.title ?? modelName(c.model)));
        return account;
      } catch (e) { d.log?.("a model could not take over the turn", { threadId: q.threadId, model: c.model, error: e instanceof Error ? e.message : String(e) }); }
    }
    throw Object.assign(new Error(NO_MODEL_WORDS), { code: NO_MODEL_WORKS });
  };

  async function say(q: ModelQuery, text: string): Promise<void> {
    if (!d.postAs) return;
    try {
      await d.postAs(q.agentId, { actingFor: q.askerId, threadId: q.threadId, body: "", mentions: [], clientId: BRIDGE_PREFIX + mintId("b").slice(2), blocks: [{ type: "turn_status", v: 1, data: { state: "note", text } }] });
    } catch (e) { d.log?.("the model swap could not be shown in the chat", { threadId: q.threadId, error: e instanceof Error ? e.message : String(e) }); }
  }
}
