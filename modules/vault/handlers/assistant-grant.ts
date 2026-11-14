// "The Assistant may use this Vault item inside this Automation" (AUTOMATIONS-2026-11-13 2.8; lead rulings 13 Nov 2026).
//
// DECISION: the grant is a scope on top of the kernel's own carrier. Giving it makes an access share of the item to the agent with the source `through-agent:<giver>` (kernel throughAgent: only the person who
// gave it reaches the item through that agent). The kernel cannot say "only inside this Automation", so the scope lives in vault_assistant_grant and is checked here at every use (use, fill, inject_env):
// the agent's reach with a grant is never wider than the kernel share alone, and an agent acting for anyone else is left to the kernel (a second person who edits the Automation does not inherit it).
// The giver's own Use is re-checked at each use (ctx.mayAll), so a giver who loses Use, leaves the Space or whose item is deleted ends the next use. Only a person's own hand gives it.
// An item its giver owns is left alone: an owner's Assistant already acts with the owner's access, and narrowing it would take that away.
import { isCompanyKey } from "../../../lib/company-keys.ts";
import { isTrustedService } from "../../../lib/trust.ts";
import { readFileSync } from "node:fs";
import { reachable } from "./items.ts";
import {
  atLeast,
  denied,
  ensure,
  first,
  isId,
  levelOn,
  newId,
  record,
  refuse,
  rowsOf,
  statements,
  str,
} from "../projections.ts";
import type { Row, VaultCtx } from "../projections.ts";

const sql = readFileSync(new URL("../migrations/0009_assistant_grant.sql", import.meta.url), "utf8");
const ready = new WeakSet<object>();

export function ensureGrants(ctx: Pick<VaultCtx, "db">): void {
  if (ready.has(ctx.db)) return;
  try {
    ctx.db.all(`SELECT "id" FROM vault_assistant_grant WHERE "id" = ?`, "probe");
  } catch {
    for (const s of statements(sql)) ctx.db.run(s);
  }
  ready.add(ctx.db);
}

export interface GrantView {
  id: string;
  itemId: string;
  automationId: string;
  automationName?: string;
  agentId: string;
  giver: string;
  threadId?: string;
  createdAt: number;
}
const view = (r: Row): GrantView => ({
  id: str(r, "id"),
  itemId: str(r, "itemId"),
  automationId: str(r, "automationId"),
  ...(str(r, "automationName") ? { automationName: str(r, "automationName") } : {}),
  agentId: str(r, "agentId"),
  giver: str(r, "giver"),
  ...(str(r, "threadId") ? { threadId: str(r, "threadId") } : {}),
  createdAt: typeof r["createdAt"] === "number" ? r["createdAt"] : 0,
});

const sourceOf = (giver: string): string => `through-agent:${giver}`;

/** A person's own hand: a person, acting for nobody, not through the MCP door. An agent, an actor, a service or an outside agent never gives or takes back a grant. */
function ownHand(ctx: VaultCtx): void {
  if (ctx.principal.kind !== "person" || ctx.actingFor !== undefined || ctx.origin === "mcp")
    denied(ctx, "Only you can let the Assistant use a key, in the app.");
}

const activeFor = (ctx: VaultCtx, where?: string, ...args: unknown[]): Row[] =>
  rowsOf(
    ctx.db.all(`SELECT * FROM vault_assistant_grant WHERE "revokedAt" IS NULL${where ? ` AND ${where}` : ""}`, ...args),
  );

export async function give(
  ctx: VaultCtx,
  input: { itemId: string; automationId: string; automationName?: string; agentId: string; threadId?: string },
) {
  ensure(ctx);
  ensureGrants(ctx);
  ownHand(ctx);
  if (!isId("vit", input.itemId) || !isId("aut", input.automationId) || !isId("agt", input.agentId))
    throw refuse(ctx, "Say which key, which Automation and which Assistant.");
  const item = reachable(ctx, input.itemId, "use");
  if (isCompanyKey(str(item, "handle")))
    return denied(ctx, "This key is for the server alone. Agents and automations never get it.");
  if (str(item, "scope") === "mine") return { already: true as const };
  const me = ctx.principal.id;
  const same = activeFor(
    ctx,
    `"itemId" = ? AND "automationId" = ? AND "agentId" = ? AND "giver" = ?`,
    input.itemId,
    input.automationId,
    input.agentId,
    me,
  )[0];
  if (same) return { grant: view(same) };
  const id = newId("vag", ctx.now());
  ctx.db.run(
    `INSERT INTO vault_assistant_grant ("id","itemId","automationId","automationName","threadId","agentId","giver","createdAt") VALUES (?,?,?,?,?,?,?,?)`,
    id,
    input.itemId,
    input.automationId,
    input.automationName ?? null,
    input.threadId ?? null,
    input.agentId,
    me,
    ctx.now(),
  );
  try {
    const shared = (await ctx.call("access.share", {
      resource: { type: "vault_item", id: input.itemId },
      subject: { kind: "agent", id: input.agentId },
      level: "use",
      source: sourceOf(me),
      idempotencyKey: `${id}:share`,
    })) as { grant?: { id?: string } } | null;
    if (shared?.grant?.id)
      ctx.db.run(`UPDATE vault_assistant_grant SET "shareId" = ? WHERE "id" = ?`, shared.grant.id, id);
  } catch (e) {
    ctx.db.run(`DELETE FROM vault_assistant_grant WHERE "id" = ?`, id); // nothing is kept when the share was not made
    throw e;
  }
  record(ctx, input.itemId, "shared", {
    detail: `The Assistant may use this in ${input.automationName ?? input.automationId}`,
  });
  const row = first(ctx.db.all(`SELECT * FROM vault_assistant_grant WHERE "id" = ?`, id));
  return { grant: view(row!) };
}

async function unshareIfLast(ctx: VaultCtx, r: Row): Promise<void> {
  const others = activeFor(
    ctx,
    `"itemId" = ? AND "agentId" = ? AND "giver" = ?`,
    str(r, "itemId"),
    str(r, "agentId"),
    str(r, "giver"),
  ).filter((o) => str(o, "id") !== str(r, "id"));
  if (others.length > 0) return; // another Automation still rests on the same share
  await ctx.call("access.unshare", {
    resource: { type: "vault_item", id: str(r, "itemId") },
    subject: { kind: "agent", id: str(r, "agentId") },
    source: sourceOf(str(r, "giver")),
  });
}

function stop(ctx: VaultCtx, id: string, why: string): void {
  ctx.db.run(
    `UPDATE vault_assistant_grant SET "revokedAt" = ?, "revokedBy" = ?, "revokedWhy" = ? WHERE "id" = ? AND "revokedAt" IS NULL`,
    ctx.now(),
    ctx.principal.id,
    why,
    id,
  );
}

/** Take a grant back: its giver, a person who manages the item, or the host (an Automation that was deleted). */
export async function revoke(
  ctx: VaultCtx,
  input: { grantId?: string; itemId?: string; automationId?: string; why?: string },
) {
  ensure(ctx);
  ensureGrants(ctx);
  const rows = input.grantId
    ? activeFor(ctx, `"id" = ?`, input.grantId)
    : input.automationId
      ? activeFor(ctx, `"automationId" = ?`, input.automationId)
      : input.itemId
        ? activeFor(ctx, `"itemId" = ?`, input.itemId)
        : [];
  const host = isTrustedService(ctx.principal);
  let revoked = 0;
  for (const r of rows) {
    if (!host) {
      ownHand(ctx);
      const mine = str(r, "giver") === ctx.principal.id;
      if (!mine && !atLeast(levelOn(ctx, "vault_item", str(r, "itemId")), "manage"))
        denied(
          ctx,
          "Only the person who let the Assistant use this key, or someone who manages it, can take that back.",
        );
    }
    stop(ctx, str(r, "id"), input.why ?? "revoked");
    await unshareIfLast(ctx, r);
    record(ctx, str(r, "itemId"), "unshared", {
      detail: `The Assistant may no longer use this in ${str(r, "automationName") || str(r, "automationId")}`,
    });
    revoked++;
  }
  return { revoked };
}

/** A deleted item takes its grants with it. */
export async function revokeForItem(ctx: VaultCtx, itemId: string): Promise<void> {
  ensureGrants(ctx);
  for (const r of activeFor(ctx, `"itemId" = ?`, itemId)) {
    stop(ctx, str(r, "id"), "item deleted");
    try {
      await unshareIfLast(ctx, r);
    } catch {
      /* the item is gone with its shares */
    }
  }
}

export async function list(ctx: VaultCtx, input: { itemId?: string; automationId?: string }) {
  ensure(ctx);
  ensureGrants(ctx);
  const rows = activeFor(ctx).filter(
    (r) =>
      (input.itemId === undefined || str(r, "itemId") === input.itemId) &&
      (input.automationId === undefined || str(r, "automationId") === input.automationId) &&
      (str(r, "giver") === ctx.principal.id || atLeast(levelOn(ctx, "vault_item", str(r, "itemId")), "view")),
  );
  return { grants: rows.map(view) };
}

// ---- the scope, checked where a value would reach an agent

async function inScope(ctx: VaultCtx, g: Row): Promise<boolean> {
  if (ctx.thread !== undefined && str(g, "threadId") !== "" && ctx.thread === str(g, "threadId")) return true;
  if (ctx.run !== undefined) {
    try {
      const out = (await ctx.call("runs.get", { runId: ctx.run })) as {
        run?: { subject?: { type?: string; id?: string } };
      } | null;
      const s = out?.run?.subject;
      return s?.type === "automation" && s.id === str(g, "automationId");
    } catch {
      return false;
    }
  }
  return false;
}

/** Whether an agent may use this item in this call, as far as an Assistant grant is concerned: null when it may (or the kernel alone decides), else the plain line to say. */
export async function scopeVerdict(ctx: VaultCtx, item: Row): Promise<string | null> {
  if (ctx.principal.kind !== "agent" || ctx.actingFor === undefined) return null;
  ensureGrants(ctx);
  const asker = ctx.actingFor;
  const mine = activeFor(
    ctx,
    `"itemId" = ? AND "agentId" = ? AND "giver" = ?`,
    str(item, "id"),
    ctx.principal.id,
    asker,
  );
  if (mine.length === 0 || str(item, "owner") === asker) return null; // someone else's share, or the owner's own Assistant: the kernel decides
  let lapsed = false;
  for (const g of mine) {
    if (!(await inScope(ctx, g))) continue;
    if (ctx.mayAll?.([asker], { perm: null, level: "use" }, { type: "vault_item", id: str(item, "id") }) === true)
      return null;
    lapsed = true;
  }
  const name = str(mine[0]!, "automationName") || "the Automation it was given for";
  return lapsed
    ? "The person who let the Assistant use this key can no longer use it themselves, so the Assistant cannot either. Choose another key or ask an admin."
    : `The Assistant may use ${str(item, "name") || "this key"} only inside "${name}". Open that Automation to let it use the key somewhere else.`;
}

export async function assistantScope(ctx: VaultCtx, item: Row): Promise<void> {
  const why = await scopeVerdict(ctx, item);
  if (why !== null) denied(ctx, why);
}
