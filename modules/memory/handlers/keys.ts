// Who pays for memory upkeep (memory ruling 6): the AI account behind the model pass that merges, dates and tidies memory. Each agent's settings hold a Memory key (agents.memory_key.get); the Space
// has one for Space memory, a project may have its own, and a person has one for their personal memory. All are picked from accounts the picker can already use (providers.list answers for them):
// a person's own accounts and the shared Vault AI providers for personal memory, shared providers only for Space and project memory (picked by an admin). No key means rule-based upkeep.
// What a scope pays with is answered by memory.key.resolve, which the upkeep model seam asks; the spend and its monthly cap are upkeep's.
import { actorOf, ensure, raise, rowsOf, str } from "../projections.ts";
import type { Layer, MemCtx } from "../projections.ts";

const TABLE = "CREATE TABLE IF NOT EXISTS memory_keys (layer TEXT NOT NULL, owner_ref TEXT NOT NULL, account_ref TEXT NOT NULL, set_by TEXT NOT NULL, set_at INTEGER NOT NULL, PRIMARY KEY (layer, owner_ref))";
const ready = new WeakSet<object>();
function tables(ctx: MemCtx): void {
  ensure(ctx.db);
  if (ready.has(ctx.db)) return;
  ctx.db.run(TABLE);
  ready.add(ctx.db);
}

interface ProviderRow { id: string; providerKey: string; name: string; connection: string; scope: "mine" | "shared"; handle?: string; itemId: string; engine: string; state: string; spaceMayUse?: boolean }
export interface Choice { ref: string; title: string; provider: string; kind: "subscription" | "api_key" | "local_model"; mine: boolean; state: string }

async function providers(ctx: MemCtx): Promise<ProviderRow[]> {
  try { return ((await ctx.call("providers.list", {})) as { providers?: ProviderRow[] }).providers ?? []; } catch { return []; }
}
const refOf = (p: ProviderRow): string => p.handle ?? p.itemId;

const adminOf = (ctx: MemCtx): boolean => ctx.authorize({ perm: "memory.admin", level: "manage" }, { type: "space", id: ctx.space }).effect === "allow";

/** Upkeep runs on the server, so a subscription can pay only when its owner has let the Space use it (the same switch a chat on the server needs). */
const upkeepable = (p: ProviderRow): boolean => p.connection !== "subscription" || p.spaceMayUse === true;

const choice = (p: ProviderRow): Choice => ({ ref: refOf(p), title: p.name, provider: p.providerKey, kind: p.connection as Choice["kind"], mine: p.scope === "mine", state: p.state });

const ownerOf = (ctx: MemCtx, layer: "space" | "project" | "person", projectId?: string): string => (layer === "space" ? ctx.space : layer === "person" ? actorOf(ctx) : projectId ?? "");

function stored(ctx: MemCtx, layer: string, owner: string): string | null {
  const r = rowsOf(ctx.db, "SELECT account_ref FROM memory_keys WHERE layer = ? AND owner_ref = ?", layer, owner)[0];
  return r ? str(r["account_ref"]) : null;
}

/** The keys the caller sees: their own, and (for an admin) the Space's and the named project's, with the accounts each picker may offer. */
export async function keysGet(ctx: MemCtx, _input: Record<string, never>) {
  tables(ctx);
  const all = (await providers(ctx)).filter(upkeepable);
  const admin = adminOf(ctx);
  const personal = stored(ctx, "person", actorOf(ctx));
  return {
    personal: { accountRef: personal, choices: all.map(choice) },
    admin,
    ...(admin ? {
      space: { accountRef: stored(ctx, "space", ctx.space), choices: all.filter((p) => p.scope === "shared").map(choice) },
      projectKeys: Object.fromEntries(rowsOf(ctx.db, "SELECT owner_ref, account_ref FROM memory_keys WHERE layer = 'project'").map((r) => [str(r["owner_ref"]), str(r["account_ref"])])),
    } : {}),
  };
}

export async function keySet(ctx: MemCtx, input: { layer: "space" | "project" | "person"; projectId?: string; accountRef: string | null }) {
  tables(ctx);
  if (input.layer === "project" && !input.projectId) raise(ctx, "validation.bad_input", "Name the project this key is for.");
  if (input.layer !== "person" && !adminOf(ctx)) raise(ctx, "permission.no_grant", "Only a Space admin sets the key for Space and project memory.");
  const owner = ownerOf(ctx, input.layer, input.projectId);
  if (input.accountRef === null) {
    ctx.db.run("DELETE FROM memory_keys WHERE layer = ? AND owner_ref = ?", input.layer, owner);
    return { layer: input.layer, accountRef: null };
  }
  const pick = (await providers(ctx)).filter(upkeepable).find((p) => refOf(p) === input.accountRef);
  if (!pick) raise(ctx, "validation.bad_input", "That account is not one you can use for memory. Pick one from the list.");
  if (input.layer !== "person" && pick.scope !== "shared") raise(ctx, "validation.bad_input", "Space and project memory is paid with a shared account, not one that is somebody's own.");
  ctx.db.run("INSERT INTO memory_keys (layer, owner_ref, account_ref, set_by, set_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(layer, owner_ref) DO UPDATE SET account_ref = excluded.account_ref, set_by = excluded.set_by, set_at = excluded.set_at",
    input.layer, owner, input.accountRef, actorOf(ctx), ctx.now());
  return { layer: input.layer, accountRef: input.accountRef };
}

const MODEL: Readonly<Record<string, string>> = { anthropic: "claude-haiku-5-5" };

/**
 * The account that pays for one scope's upkeep. Agent memory: the agent's Memory key, else the Space's. Project: the project's, else the Space's. Space: the Space's. A person's: their own, only
 * when they are the one asking. The answer names the account and where the choice came from; no key at all is `no_key` and upkeep for that scope stays rule-based. A key that was picked and is no
 * longer there (removed, signed out) is `key_unavailable`, and upkeep does not fall through to another scope's key without saying so.
 */
export async function keyResolve(ctx: MemCtx, input: { layer: Layer; ownerRef: string; agentId?: string; projectId?: string }) {
  tables(ctx);
  const candidates: Array<{ ref: string | null; source: "agent" | "project" | "space" | "person" }> = [];
  if (input.layer === "person") {
    if (input.ownerRef === actorOf(ctx)) candidates.push({ ref: stored(ctx, "person", input.ownerRef), source: "person" });
  } else {
    if (input.layer === "agent" && input.agentId) {
      let mk: string | null = null;
      try { mk = str(((await ctx.call("agents.memory_key.get", { agentId: input.agentId })) as { memoryKey?: string }).memoryKey) || null; } catch { mk = null; }
      candidates.push({ ref: mk, source: "agent" });
    }
    if (input.layer === "project" || (input.layer === "agent" && input.projectId)) candidates.push({ ref: stored(ctx, "project", input.projectId ?? input.ownerRef), source: "project" });
    candidates.push({ ref: stored(ctx, "space", ctx.space), source: "space" });
  }
  const chosen = candidates.find((c) => c.ref);
  if (!chosen?.ref) return { reason: "no_key" as const };
  const row = (await providers(ctx)).filter(upkeepable).find((p) => refOf(p) === chosen.ref);
  if (!row || row.state === "needs_sign_in" || row.state === "failing") return { reason: "key_unavailable" as const, key: { accountRef: chosen.ref, source: chosen.source } };
  const model = MODEL[row.providerKey];
  return { key: { accountRef: chosen.ref, provider: row.providerKey, kind: row.connection, source: chosen.source, ...(model ? { model } : {}) } };
}
