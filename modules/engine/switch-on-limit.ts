// "Switch when limits run out" (per agent, on by default). The turn engine already retries a turn on the next usable account when the one paying fails with an account error before the turn said anything
// (provider.rate_limited covers a usage limit, a quota and a 429; auth failures move on too). This is the host half of that: it asks the agent whether it may switch, remembers an account that just ran out so the
// next turns in the chat do not try it first, and tells the chat with the existing model_switch block (from and to provider, model and effort) so the person sees which account answered.
import type { AccountQuery, ResolvedAccount } from "../../agent/src/turn-engine/types.ts";
import { chatSettings } from "./chat-settings.ts";
import { BRIDGE_PREFIX } from "./handlers/bridge.ts";
import type { PostAs } from "./handlers/bridge.ts";
import { mintId } from "./projections.ts";

type Call = (cap: string, input: unknown, as?: string) => Promise<unknown>;

export interface LimitSwitchDeps {
  call: Call;
  /** engine.account.resolve, with the accounts that already failed in `unavailable`. */
  accountFor(q: AccountQuery): Promise<ResolvedAccount | null>;
  postAs?: PostAs;
  /** The model the agent answers with in the thread, as the engine holds it. */
  modelOf?(threadId: string, agentId: string): string | undefined;
  /** The provider an account belongs to (engine.accounts.list), by its ref. */
  providerOf?(ref: string, payer: string): Promise<string | undefined>;
  /** Has someone said this paid key may answer here (hole 7)? Absent: nobody has, so it asks. */
  paidOk?(q: AccountQuery, ref: string): boolean;
  /** Raise the Need: one per chat, agent and key. */
  askToPay?(q: AccountQuery, to: ResolvedAccount): Promise<void>;
  now?: () => number;
  log?: (msg: string, attrs?: Record<string, unknown>) => void;
}

/** How long a chat leaves an account alone after it ran out. A usage limit resets in hours; a short rest keeps the next message from paying for the same failure. */
export const LIMIT_REST_MS = 10 * 60_000;

/** A key billed by use, unlike a subscription already paid for or a local model. */
export const isPaid = (a: Pick<ResolvedAccount, "kind" | "keyless">): boolean => a.kind === "api_key" && a.keyless !== true;
/** The turn ends with this: the next account would cost money and nobody has said yes. */
export const PAID_FALLBACK = "paid_fallback";

export function createLimitSwitch(d: LimitSwitchDeps): { resolve(q: AccountQuery): Promise<ResolvedAccount | null>; next(q: AccountQuery): Promise<ResolvedAccount | null> } {
  const now = d.now ?? Date.now;
  const resting = new Map<string, Map<string, number>>();
  const key = (q: AccountQuery): string => `${q.threadId}|${q.agentId}`;
  const restingRefs = (q: AccountQuery): string[] => {
    const m = resting.get(key(q));
    if (!m) return [];
    const t = now();
    for (const [ref, until] of m) if (until <= t) m.delete(ref);
    return [...m.keys()];
  };
  const withResting = (q: AccountQuery): AccountQuery => {
    const rest = restingRefs(q).filter((r) => !(q.unavailable ?? []).includes(r));
    return rest.length === 0 ? q : { ...q, unavailable: [...(q.unavailable ?? []), ...rest] };
  };

  async function mayAct(q: AccountQuery): Promise<boolean> {
    try {
      const a = (await d.call("agents.get", { agentId: q.agentId }, q.askerId)) as { agent?: { switchOnLimit?: boolean } };
      return a.agent?.switchOnLimit !== false;
    } catch { return true; }
  }

  /**
   * Falling back to a paid key is a person's call (hole 7): the turn stops and they get one Need. It only applies to a fallback: an API key that is the person's first choice is simply what they use, and a key
   * on the agent's fallback list or in their own fallback order (reason backup_key) was already chosen for this.
   */
  async function mustAsk(q: AccountQuery, to: ResolvedAccount): Promise<boolean> {
    const fellBack = to.fellBack === true || (q.unavailable ?? []).length > 0;
    return isPaid(to) && fellBack && to.reason !== "backup_key" && d.paidOk?.(q, to.ref) !== true;
  }
  async function stopFor(q: AccountQuery, to: ResolvedAccount): Promise<never> {
    try { await d.askToPay?.(q, to); } catch (e) { d.log?.("the paid key could not be offered", { threadId: q.threadId, error: e instanceof Error ? e.message : String(e) }); }
    throw Object.assign(new Error("A paid key could answer, and that is yours to decide."), { code: PAID_FALLBACK });
  }

  async function announce(q: AccountQuery, failed: string, to: ResolvedAccount): Promise<void> {
    if (!d.postAs) return;
    try {
      const s = await chatSettings(d.call, q.threadId, q.agentId, q.askerId);
      const model = s.model ?? d.modelOf?.(q.threadId, q.agentId) ?? "default";
      const fromProvider = (await d.providerOf?.(failed, q.askerId).catch(() => undefined)) ?? "unknown";
      const side = (provider: string) => ({ provider, model, ...(s.effort !== undefined ? { effort: s.effort } : {}) });
      await d.postAs(q.agentId, {
        actingFor: q.askerId, threadId: q.threadId, body: "", mentions: [], clientId: BRIDGE_PREFIX + mintId("b").slice(2),
        blocks: [{ type: "model_switch", v: 1, data: { threadId: q.threadId, agentId: q.agentId, scope: "thread", from: side(fromProvider), to: side(to.provider), reason: "The first account ran out of its limit, so this answer came from the next one." } }],
      });
    } catch (e) { d.log?.("the account switch could not be shown in the chat", { threadId: q.threadId, error: e instanceof Error ? e.message : String(e) }); }
  }

  return {
    /** Before every turn: the account that pays, skipping the ones that just ran out in this chat. */
    resolve: async (q) => {
      const first = (await d.accountFor(withResting(q))) ?? (restingRefs(q).length > 0 ? await d.accountFor(q) : null);   // nothing else left: try the resting account again rather than stop
      if (!first || !(await mustAsk(q, first))) return first;
      // the account that ran out may be back: try it before asking anyone to pay
      if (restingRefs(q).length > 0) { const rested = await d.accountFor(q); if (rested && !(await mustAsk(q, rested))) return rested; }
      return stopFor(q, first);
    },
    /** After a limit or sign-in failure: the next usable account, or null when the agent keeps to one account or none is left. */
    async next(q) {
      const failed = (q.unavailable ?? []).at(-1);
      if (failed === undefined || !(await mayAct(q))) return null;
      const to = await d.accountFor(withResting(q));
      if (!to) return null;
      if (await mustAsk(q, to)) return stopFor(q, { ...to, fellBack: true });
      const m = resting.get(key(q)) ?? new Map<string, number>();
      m.set(failed, now() + LIMIT_REST_MS);
      resting.set(key(q), m);
      await announce(q, failed, to);
      return to;
    },
  };
}
