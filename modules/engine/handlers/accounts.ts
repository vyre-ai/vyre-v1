// engine accounts (spec 4.14, 2.17; ARCH 6.4): engine.account.resolve, engine.accounts.list, engine.probe_account.
// The decisions live in @vyre/agent (agent/src/accounts); these handlers gather what they need through capabilities (providers.list, threads.get, agents.get,
// engine.policy.get, engine.defaults.get, engine.placement.decide, providers.test) and never read a Vault value. providers.list answers for the person the call acts for,
// so the worker calls engine.account.resolve acting for the payer (the steerer or the starter): a Mine account of anyone else is never in the list.
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import { VyreErr } from "../../../packages/contracts/src/errors.ts";
import { resolveAccount, probeAccount, providerOfModel, UnknownAccount } from "../../../agent/src/accounts/index.ts";
import type { AccountRow, AccountStatus, ProbeResult, SpaceUses, Trigger } from "../../../agent/src/accounts/index.ts";
import { costTier } from "../../../agent/src/accounts/cost.ts";
import { savedTested } from "../live-models.ts";

interface ProviderRow {
  id: string; providerKey: string; name: string; connection: "subscription" | "api_key" | "local_model"; scope: "mine" | "shared"; handle?: string; itemId: string;
  engine: string; spaceMayUse: boolean; state: "ok" | "needs_sign_in" | "failing"; address?: string; keyless?: boolean; itemName?: string; spaceKey?: boolean;
  /** A sign-in's name: the one the person gave it, else the provider and its account. */
  displayName?: string;
  /** Handles of sign-ins of the same account folded into this row. */
  aliases?: string[];
  /** An older sign-in of the same provider whose account cannot be read: the provider id of the row it is listed under. */
  olderOf?: string;
  /** A Space AI account (owner ruling 9): what it pays for, whether team chats reach this person, whether it hit its cap, and the models it serves. */
  uses?: SpaceUses; teamChatsForMe?: boolean; capped?: boolean; models?: string[];
}
interface ThreadOut { thread: { starter: string; agents: Array<{ agentId: string; accountRef?: string; provider?: string; model?: string }> } }
interface AgentOut { agent: { accountPolicy: "asker" | "key"; accountKey?: string; accountFallback?: string[]; model?: string } }
interface PolicyOut { allowedAccounts: "any" | "company" }
interface DefaultsOut { fallback: Array<{ accountRef?: string }> }
interface PlacementOut { placement: "host" | "device" | "wait" }

const STATUS: Readonly<Record<ProviderRow["state"], AccountStatus>> = { ok: "ok", needs_sign_in: "expired", failing: "failed" };
const DRIVERS = new Set(["anthropic", "openai", "openrouter", "google", "xai", "opencode_go", "local", "custom", "claude_code", "codex", "grok"]);

function driverOf(p: ProviderRow): string {
  const e = p.engine.replace(/-/g, "_");
  if (DRIVERS.has(e)) return e;
  if (p.connection === "local_model") return "local";
  return DRIVERS.has(p.providerKey) ? p.providerKey : "openrouter";
}

export interface Loaded {
  rows: AccountRow[]; idByRef: Map<string, string>; itemByRef: Map<string, string>; where: Map<string, { base?: string; keyless?: boolean }>; names: Map<string, string>;
  /** A folded handle to the ref of the row that kept the account. */
  aliasOf: Map<string, string>;
  /** An older sign-in's ref to the ref of the row it is listed under. */
  underOf: Map<string, string>;
}

/** The ref that pays for a pin: a handle that was folded into another row of the same account names that row. */
export function canonical(l: Pick<Loaded, "aliasOf">, ref: string): string {
  const [handle = "", ...field] = ref.split(".");
  const to = l.aliasOf.get(ref) ?? l.aliasOf.get(handle);
  return to === undefined ? ref : [to, ...field].join(".");
}

export async function load(ctx: Pick<Ctx, "actingFor" | "principal" | "call">): Promise<Loaded> {
  const me = ctx.actingFor ?? ctx.principal.id;
  const out = (await ctx.call("providers.list", {})) as { providers: ProviderRow[] };
  const rows: AccountRow[] = [];
  const idByRef = new Map<string, string>();
  const itemByRef = new Map<string, string>();
  const where = new Map<string, { base?: string; keyless?: boolean }>();
  const names = new Map<string, string>();
  const aliasOf = new Map<string, string>();
  const underOf = new Map<string, string>();
  const refById = new Map(out.providers.map((p) => [p.id, p.handle ?? p.itemId] as const));
  for (const p of out.providers) {
    const ref = p.handle ?? p.itemId;
    idByRef.set(ref, p.id);
    itemByRef.set(ref, p.itemId);
    for (const a of p.aliases ?? []) aliasOf.set(a, ref);
    const under = p.olderOf ? refById.get(p.olderOf) : undefined;
    if (under) underOf.set(ref, under);
    // a sign-in reads by the name the person gave it or its account, never "Claude Code 4"; the Space AI key reads as its provider, like any other
    const name = p.displayName ?? p.itemName;
    if (name && p.spaceKey !== true) names.set(ref, name);
    if (p.address || p.keyless) where.set(ref, { ...(p.address ? { base: p.address } : {}), ...(p.keyless ? { keyless: true } : {}) });
    rows.push({
      ref, driver: driverOf(p), provider: p.providerKey, kind: p.connection === "subscription" ? "subscription" : "api_key", title: p.name,
      mine: p.scope === "mine", ownerId: p.scope === "mine" ? me : null, status: STATUS[p.state], lastProbeAt: null, spaceMayUse: p.spaceMayUse,
      ...(p.spaceKey === true ? { spaceKey: true } : {}), ...(under ? { older: true } : {}),
      ...(p.scope === "shared" && p.uses ? { uses: p.uses, ...(p.teamChatsForMe !== undefined ? { teamChatsForMe: p.teamChatsForMe } : {}), ...(p.capped === true ? { capped: true } : {}), cost: costTier(driverOf(p)) } : {}),
      ...(p.models?.length ? { models: p.models } : {}),
    });
  }
  return { rows, idByRef, itemByRef, where, names, aliasOf, underOf };
}

/** One entry per account: older sign-ins of a provider whose account cannot be read are listed under the row they show as (and can be removed there), and a pin to a folded handle or an older sign-in shows that row. */
export async function accountsList(ctx: Ctx, _input: Record<string, never>) {
  const { rows, where, names, idByRef, aliasOf, underOf } = await load(ctx);
  return {
    accounts: rows.filter((r) => !underOf.has(r.ref)).map((r) => {
      const older = rows.filter((o) => underOf.get(o.ref) === r.ref).map((o) => ({ ref: o.ref, providerId: idByRef.get(o.ref)!, name: names.get(o.ref) ?? o.title }));
      const aliases = [...[...aliasOf].filter(([, to]) => to === r.ref).map(([from]) => from), ...older.map((o) => o.ref)];
      return {
        ...where.get(r.ref),
        ref: r.ref, driver: r.driver, kind: r.kind, title: r.title, ...(names.has(r.ref) ? { name: names.get(r.ref) } : {}), mine: r.mine, ...(r.ownerId ? { ownerId: r.ownerId } : {}), status: r.status,
        ...(r.lastProbeAt !== null ? { lastProbeAt: r.lastProbeAt } : {}), ...(r.spaceKey === true ? { spaceKey: true } : {}),
        ...(aliases.length > 0 ? { aliases } : {}), ...(older.length > 0 ? { older } : {}),
      };
    }),
  };
}

/** What caused the turn, as the turn engine says it, to the resolver's trigger. */
type TurnKind = "chat" | "wake" | "automation" | "goal" | "agent_work";
const TRIGGER: Readonly<Record<TurnKind, Trigger>> = { chat: "message", wake: "wake", automation: "task", goal: "goal", agent_work: "routine" };

export async function accountResolve(ctx: Ctx, input: { threadId: string; agentId: string; askerId?: string; stepKey?: string; unavailable?: string[]; kind?: TurnKind; dry?: boolean }) {
  const [t, a, policy, defaults, placement, accounts] = await Promise.all([
    ctx.call("threads.get", { threadId: input.threadId }) as Promise<ThreadOut>,
    ctx.call("agents.get", { agentId: input.agentId }) as Promise<AgentOut>,
    ctx.call("engine.policy.get", {}) as Promise<PolicyOut>,
    ctx.call("engine.defaults.get", {}) as Promise<DefaultsOut>,
    ctx.call("engine.placement.decide", { threadId: input.threadId, agentId: input.agentId, kind: "message" }) as Promise<PlacementOut>,
    load(ctx),
  ]);
  const member = t.thread.agents.find((x) => x.agentId === input.agentId);
  // a pin, a key or a fallback that names a handle folded into another row of the same account pays with that row
  const c = (ref: string): string => canonical(accounts, ref);
  const provider = member?.provider ?? providerOfModel(member?.model ?? a.agent.model);
  // a Personal Space runs on the person's own computer, so a turn on its host is a turn on their computer: their sign-in needs no "the Space may use it" switch there
  const personal = await (ctx.call("spaces.get", {}) as Promise<{ space?: { kind?: string } }>).then((r) => r.space?.kind === "personal", () => false);
  // a Space account fits when its provider lists the turn's model: the Vault's kept list, else the one this engine saved from its last test
  for (const r of accounts.rows) if (!r.mine && !r.models?.length) { try { const m = savedTested(ctx.db as never, r.ref); if (m.length > 0) r.models = m; } catch { /* nothing saved */ } }
  const trigger: Trigger = input.stepKey ? "task" : TRIGGER[input.kind ?? "chat"];
  const model = member?.model ?? a.agent.model;
  // the composer's check before sending: the caller is the one who would ask (their own accounts, their team chats)
  const asker = input.askerId ?? (input.dry === true ? ctx.actingFor ?? ctx.principal.id : undefined);
  const res = resolveAccount({
    starter: t.thread.starter,
    ...(asker ? { steerer: asker } : {}),
    trigger,
    ...(trigger === "routine" ? { routineOwner: input.askerId ?? t.thread.starter } : {}),
    ...(model ? { model } : {}),
    // the person chose the chat's account and its model together: a list that does not have the model fails the turn rather than run elsewhere
    ...(member?.accountRef && member?.model ? { modelPinned: true } : {}),
    ...(member?.accountRef ? { threadAccountRef: c(member.accountRef) } : {}),
    agent: { agentId: input.agentId, accountPolicy: a.agent.accountPolicy, ...(a.agent.accountKey ? { accountKey: c(a.agent.accountKey) } : {}), ...(a.agent.accountFallback?.length ? { accountFallback: a.agent.accountFallback.map(c) } : {}), ...(provider ? { provider } : {}) },
    ...(input.stepKey ? { stepKey: c(input.stepKey) } : {}),
    backupRefs: defaults.fallback.flatMap((f) => (f.accountRef ? [c(f.accountRef)] : [])),
    policy: policy.allowedAccounts,
    accounts: accounts.rows,
    onServer: placement.placement !== "device" && !personal,
    ...(input.unavailable?.length ? { unavailable: input.unavailable.map(c) } : {}),
  });
  // the Vault item behind the account, so the turn worker can meter usage against it (record_usage itemId)
  const itemId = res.accountRef ? accounts.itemByRef.get(res.accountRef) : undefined;
  // an account ahead of this one was passed over: what pays is a fallback, whatever the reason word says
  const fellBack = res.accountRef !== null && res.tried.some((a) => !a.used && (a.why === "expired" || a.why === "failed" || a.why === "failed_this_turn" || a.why === "capped"));
  return { accountRef: res.accountRef, payer: res.payer, reason: res.reason, allowed: res.allowed, ...(itemId ? { itemId } : {}), ...(fellBack ? { fellBack: true } : {}), ...(res.pin ? { pin: res.pin } : {}), ...(!res.allowed && res.unblock ? { why: res.unblock.why } : {}),
    ...(res.modelFallback && res.accountRef && model ? { modelFallback: { from: model, ...(accounts.rows.find((r) => r.ref === res.accountRef)?.models?.[0] ? { to: accounts.rows.find((r) => r.ref === res.accountRef)!.models![0]! } : {}) } } : {}) };
}

export async function accountProbe(ctx: Ctx, input: { accountRef: string }) {
  const loaded = await load(ctx);
  const { rows, idByRef } = loaded;
  input = { ...input, accountRef: canonical(loaded, input.accountRef) };
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
