// engine accounts (spec 4.14, 2.17; ARCH 6.4): engine.account.resolve, engine.accounts.list, engine.probe_account.
// The decisions live in @vyre/agent (agent/src/accounts); these handlers gather what they need through capabilities (providers.list, threads.get, agents.get,
// engine.policy.get, engine.defaults.get, engine.placement.decide, providers.test) and never read a Vault value. providers.list answers for the person the call acts for,
// so the worker calls engine.account.resolve acting for the payer (the steerer or the starter): a Mine account of anyone else is never in the list.
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import { VyreErr } from "../../../packages/contracts/src/errors.ts";
import { resolveAccount, probeAccount, providerOfModel, UnknownAccount } from "../../../agent/src/accounts/index.ts";
import type { AccountRow, AccountStatus, ProbeResult } from "../../../agent/src/accounts/index.ts";

interface ProviderRow {
  id: string; providerKey: string; name: string; connection: "subscription" | "api_key" | "local_model"; scope: "mine" | "shared"; handle?: string; itemId: string;
  engine: string; spaceMayUse: boolean; state: "ok" | "needs_sign_in" | "failing";
}
interface ThreadOut { thread: { starter: string; agents: Array<{ agentId: string; accountRef?: string; provider?: string; model?: string }> } }
interface AgentOut { agent: { accountPolicy: "asker" | "key"; accountKey?: string; model?: string } }
interface PolicyOut { allowedAccounts: "any" | "company" }
interface DefaultsOut { fallback: Array<{ accountRef?: string }> }
interface PlacementOut { placement: "host" | "device" | "wait" }

const STATUS: Readonly<Record<ProviderRow["state"], AccountStatus>> = { ok: "ok", needs_sign_in: "expired", failing: "failed" };
const DRIVERS = new Set(["anthropic", "openai", "openrouter", "google", "xai", "opencode_go", "local", "claude_code", "codex", "grok"]);

function driverOf(p: ProviderRow): string {
  const e = p.engine.replace(/-/g, "_");
  if (DRIVERS.has(e)) return e;
  if (p.connection === "local_model") return "local";
  return DRIVERS.has(p.providerKey) ? p.providerKey : "openrouter";
}

async function load(ctx: Ctx): Promise<{ rows: AccountRow[]; idByRef: Map<string, string>; itemByRef: Map<string, string> }> {
  const me = ctx.actingFor ?? ctx.principal.id;
  const out = (await ctx.call("providers.list", {})) as { providers: ProviderRow[] };
  const rows: AccountRow[] = [];
  const idByRef = new Map<string, string>();
  const itemByRef = new Map<string, string>();
  for (const p of out.providers) {
    const ref = p.handle ?? p.itemId;
    idByRef.set(ref, p.id);
    itemByRef.set(ref, p.itemId);
    rows.push({
      ref, driver: driverOf(p), provider: p.providerKey, kind: p.connection === "subscription" ? "subscription" : "api_key", title: p.name,
      mine: p.scope === "mine", ownerId: p.scope === "mine" ? me : null, status: STATUS[p.state], lastProbeAt: null, spaceMayUse: p.spaceMayUse,
    });
  }
  return { rows, idByRef, itemByRef };
}

export async function accountsList(ctx: Ctx, _input: Record<string, never>) {
  const { rows } = await load(ctx);
  return {
    accounts: rows.map((r) => ({
      ref: r.ref, driver: r.driver, kind: r.kind, title: r.title, mine: r.mine, ...(r.ownerId ? { ownerId: r.ownerId } : {}), status: r.status,
      ...(r.lastProbeAt !== null ? { lastProbeAt: r.lastProbeAt } : {}),
    })),
  };
}

export async function accountResolve(ctx: Ctx, input: { threadId: string; agentId: string; askerId?: string; stepKey?: string }) {
  const [t, a, policy, defaults, placement, accounts] = await Promise.all([
    ctx.call("threads.get", { threadId: input.threadId }) as Promise<ThreadOut>,
    ctx.call("agents.get", { agentId: input.agentId }) as Promise<AgentOut>,
    ctx.call("engine.policy.get", {}) as Promise<PolicyOut>,
    ctx.call("engine.defaults.get", {}) as Promise<DefaultsOut>,
    ctx.call("engine.placement.decide", { threadId: input.threadId, agentId: input.agentId, kind: "message" }) as Promise<PlacementOut>,
    load(ctx),
  ]);
  const member = t.thread.agents.find((x) => x.agentId === input.agentId);
  const provider = member?.provider ?? providerOfModel(member?.model ?? a.agent.model);
  const res = resolveAccount({
    starter: t.thread.starter,
    ...(input.askerId ? { steerer: input.askerId } : {}),
    trigger: input.stepKey ? "task" : "message",
    ...(member?.accountRef ? { threadAccountRef: member.accountRef } : {}),
    agent: { accountPolicy: a.agent.accountPolicy, ...(a.agent.accountKey ? { accountKey: a.agent.accountKey } : {}), ...(provider ? { provider } : {}) },
    ...(input.stepKey ? { stepKey: input.stepKey } : {}),
    backupRefs: defaults.fallback.flatMap((f) => (f.accountRef ? [f.accountRef] : [])),
    policy: policy.allowedAccounts,
    accounts: accounts.rows,
    onServer: placement.placement !== "device",
  });
  // the Vault item behind the account, so the turn worker can meter usage against it (record_usage itemId)
  const itemId = res.accountRef ? accounts.itemByRef.get(res.accountRef) : undefined;
  return { accountRef: res.accountRef, payer: res.payer, reason: res.reason, allowed: res.allowed, ...(itemId ? { itemId } : {}) };
}

export async function accountProbe(ctx: Ctx, input: { accountRef: string }) {
  const { rows, idByRef } = await load(ctx);
  const result = await probeAccount({
    find: (ref) => rows.find((r) => r.ref === ref),
    run: async (row): Promise<ProbeResult> => {
      const id = idByRef.get(row.ref);
      if (!id) return { ok: false, error: { code: "provider.auth_failed", message: "No connection for this account." } };
      const r = (await ctx.call("providers.test", { providerId: id })) as { ok: boolean; models: string[]; detail?: string };
      if (r.ok) return { ok: true, models: r.models.length };
      const code = row.status === "expired" ? "auth.expired" : "provider.auth_failed";
      return { ok: false, error: { code, message: r.detail ?? "The provider did not accept this account." } };
    },
    record: () => {},
    now: () => ctx.now(),
  }, input.accountRef).catch((e: unknown) => {
    if (e instanceof UnknownAccount) {
      throw new VyreErr({ code: "validation.not_found", message: "There is no such account.", retryable: false, traceId: ctx.trace.traceId, next: [{ kind: "report", label: "Report a problem" }] });
    }
    throw e;
  });
  if (result.ok) return { ok: true, ...(result.models !== undefined ? { models: result.models } : {}) };
  const code = result.error?.code ?? "provider.unavailable";
  return {
    ok: false,
    error: { code, message: result.error?.message ?? "The provider did not answer.", next: [{ kind: code === "auth.expired" ? "reconnect" : "open_settings", label: code === "auth.expired" ? "Sign in again" : "Open AI settings" }], traceId: ctx.trace.traceId },
  };
}
