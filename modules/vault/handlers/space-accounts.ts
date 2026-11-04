// Space AI accounts (owner ruling 9): shared providers an owner or admin keeps for the Space, each with what it may pay for and an optional monthly spend cap. The engine picks among them
// (agent/src/accounts/resolve.ts); this file keeps their settings and answers them in providers.list.
//   teamChats   a member's own chat, only when they have no account of their own that can pay: everyone, or the people in some groups
//   automations automation steps
//   goals       goal turns and wake-ups
//   agentWork   work an agent does with no asker (routines, watchers, helpers): every agent, or some
// DECISION: a shared key nobody set uses for keeps working the way the Vault panel promised ("Automations and agents without a key of their own run on it"): while the Space may use it, it pays
// for every use, for the people who can Use it in the Vault. Setting uses makes it a Space account every member's turn can reach, whatever the Vault's sharing, because the engine alone fills it.
// DECISION: the Space AI key from before is a Space account with every use on (team chats for everyone, automations, goals, all agents' work), so nothing that ran on it stops; admins narrow it
// later. It is moved over the first time anything here reads the Vault. A Space AI key set in Console afterwards starts the same way.
import { readFileSync } from "node:fs";
import { bad, first, num, parseJson, record, rowsOf, statements, str } from "../projections.ts";
import type { Row, VaultCtx } from "../projections.ts";
import { touch } from "./use.ts";

export interface SpaceUses { teamChats?: { who: "everyone" | string[] }; automations?: true; goals?: true; agentWork?: { which: "all" | string[] } }
export interface Kept { uses: SpaceUses; capCents: number | null; models: string[]; set: boolean }

const sql = readFileSync(new URL("../migrations/0007_provider_uses.sql", import.meta.url), "utf8");
const keepsSql = readFileSync(new URL("../migrations/0008_provider_keeps.sql", import.meta.url), "utf8");
const ready = new WeakSet<object>();
const keepsReady = new WeakSet<object>();
const me = (ctx: VaultCtx): string => ctx.actingFor ?? ctx.principal.id;
const live = (r: Row): boolean => r["deleted_at"] === null || r["deleted_at"] === undefined;

/** Every use on: what the Space AI key paid for before Space accounts. */
export const ALL_USES: SpaceUses = { teamChats: { who: "everyone" }, automations: true, goals: true, agentWork: { which: "all" } };

/** The table, and the Space AI key from before moved over as a Space account with every use on. */
export function ensureUses(ctx: VaultCtx): void {
  if (!ready.has(ctx.db)) {
    try { ctx.db.all(`SELECT "providerId" FROM vault_provider_uses WHERE "providerId" = ?`, "probe"); } catch { for (const s of statements(sql)) ctx.db.run(s); }
    ready.add(ctx.db);
  }
  let key: Row | null = null;
  try { key = first(ctx.db.all(`SELECT * FROM vault_space_key WHERE "id" = ?`, "space")); } catch { return; }
  if (!key || first(ctx.db.all(`SELECT "providerId" FROM vault_provider_uses WHERE "providerId" = ?`, str(key, "providerId")))) return;
  ctx.db.run(`INSERT INTO vault_provider_uses ("providerId", "uses", "capCents", "models", "setBy", "setAt") VALUES (?, ?, ?, ?, ?, ?)`,
    str(key, "providerId"), JSON.stringify(ALL_USES), null, typeof key["models"] === "string" ? key["models"] : "[]", str(key, "setBy"), num(key, "setAt"));
}

/** A new Space AI key is a Space account with every use on (providers.space_key.set). */
export function keepSpaceKey(ctx: VaultCtx, providerId: string, models: readonly string[]): void {
  ensureUses(ctx);
  ctx.db.run(`DELETE FROM vault_provider_uses WHERE "providerId" = ?`, providerId);
  ctx.db.run(`INSERT INTO vault_provider_uses ("providerId", "uses", "capCents", "models", "setBy", "setAt") VALUES (?, ?, ?, ?, ?, ?)`,
    providerId, JSON.stringify(ALL_USES), null, JSON.stringify(models), me(ctx), ctx.now());
}

/** The models a provider's test listed, kept for a Space account so the engine can tell whether it serves a turn's model. */
export function keepModels(ctx: VaultCtx, providerId: string, models: readonly string[]): void {
  ensureUses(ctx);
  if (models.length > 0) ctx.db.run(`UPDATE vault_provider_uses SET "models" = ? WHERE "providerId" = ?`, JSON.stringify(models), providerId);
}

/** What a shared provider may pay for: what an owner or admin set, else the default a shared key always had. Null for a Mine provider or a sign-in. */
export function keptFor(ctx: VaultCtx, p: Row): Kept | null {
  if (str(p, "scope") !== "shared" || str(p, "connection") === "subscription") return null;
  ensureUses(ctx);
  const r = first(ctx.db.all(`SELECT * FROM vault_provider_uses WHERE "providerId" = ?`, str(p, "id")));
  if (r) return { uses: parseJson<SpaceUses>(r["uses"], {}), capCents: typeof r["capCents"] === "number" ? r["capCents"] : null, models: parseJson<string[]>(r["models"], []), set: true };
  return { uses: num(p, "spaceMayUse") === 1 ? ALL_USES : {}, capCents: null, models: [], set: false };
}

/** Is the person in one of these groups (directly)? Unknown groups, or an access module that does not answer, count as no. */
async function inGroups(ctx: VaultCtx, person: string, groups: readonly string[]): Promise<boolean> {
  for (const groupId of groups) {
    try {
      const g = (await ctx.call("access.groups.get", { groupId })) as { group?: { members?: Array<{ id?: string }> } };
      if ((g.group?.members ?? []).some((m) => m.id === person)) return true;
    } catch { /* not a group this caller can read: no */ }
  }
  return false;
}

/** The Space-account fields of a providers.list row, for the person the list is for. */
export async function spaceFields(ctx: VaultCtx, p: Row, spentCents: number, spaceKeyModels?: readonly string[]): Promise<Record<string, unknown>> {
  const k = keptFor(ctx, p);
  if (!k) return {};
  const who = k.uses.teamChats?.who;
  const forMe = who === undefined ? false : who === "everyone" ? true : await inGroups(ctx, me(ctx), who);
  // the Space AI key keeps its own list, asked again from the provider when it is old (space-key.ts); every other account keeps what its last test listed
  const models = spaceKeyModels !== undefined && spaceKeyModels.length > 0 ? [...spaceKeyModels] : k.models;
  return {
    uses: k.uses, usesSet: k.set, ...(k.capCents !== null ? { capCents: k.capCents, capped: spentCents >= k.capCents } : {}),
    ...(who !== undefined ? { teamChatsForMe: forMe } : {}), ...(models.length > 0 ? { models } : {}),
  };
}

/** Shown to every member: a shared provider an owner or admin set uses for (the engine alone fills it, never the member). */
export function isSpaceAccount(ctx: VaultCtx, providerId: string): boolean {
  ensureUses(ctx);
  return first(ctx.db.all(`SELECT "providerId" FROM vault_provider_uses WHERE "providerId" = ?`, providerId)) !== null;
}

function parseUses(ctx: VaultCtx, v: unknown): SpaceUses {
  if (!v || typeof v !== "object" || Array.isArray(v)) return bad(ctx, "Say what the account may pay for.");
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!["teamChats", "automations", "goals", "agentWork"].includes(k)) return bad(ctx, `${k} is not a use. The uses are teamChats, automations, goals and agentWork.`);
  const ids = (x: unknown, prefix: string): string[] | null => (Array.isArray(x) && x.length > 0 && x.every((s) => typeof s === "string" && s.startsWith(`${prefix}_`)) ? [...new Set(x as string[])] : null);
  const out: SpaceUses = {};
  if (o["teamChats"] !== undefined) {
    const who = (o["teamChats"] as { who?: unknown } | null)?.who;
    const groups = ids(who, "grp");
    if (who !== "everyone" && !groups) return bad(ctx, "Team chats are for everyone or for a list of groups.");
    out.teamChats = { who: groups ?? "everyone" };
  }
  if (o["automations"] === true) out.automations = true;
  else if (o["automations"] !== undefined) return bad(ctx, "automations is true or left out.");
  if (o["goals"] === true) out.goals = true;
  else if (o["goals"] !== undefined) return bad(ctx, "goals is true or left out.");
  if (o["agentWork"] !== undefined) {
    const which = (o["agentWork"] as { which?: unknown } | null)?.which;
    const agents = ids(which, "agt");
    if (which !== "all" && !agents) return bad(ctx, "Agent work is for all agents or a list of agents.");
    out.agentWork = { which: agents ?? "all" };
  }
  return out;
}

/** providers.uses.set: an owner or admin says what a shared provider may pay for, and its monthly cap. Answers the provider row id; the handler answers the row. */
export function setUses(ctx: VaultCtx, p: Row, input: { uses: unknown; capCents?: number | null }): void {
  if (str(p, "scope") !== "shared" || str(p, "connection") === "subscription") return bad(ctx, "Only a key shared with the Space can pay for the Space. Your own accounts already pay for your own turns.");
  const uses = parseUses(ctx, input.uses);
  if (input.capCents !== undefined && input.capCents !== null && (!Number.isInteger(input.capCents) || input.capCents < 0)) return bad(ctx, "A cap is a whole number of cents, 0 or more.");
  ensureUses(ctx);
  const was = first(ctx.db.all(`SELECT * FROM vault_provider_uses WHERE "providerId" = ?`, str(p, "id")));
  const cap = input.capCents === undefined ? (was && typeof was["capCents"] === "number" ? was["capCents"] : null) : input.capCents;
  ctx.db.run(`DELETE FROM vault_provider_uses WHERE "providerId" = ?`, str(p, "id"));
  ctx.db.run(`INSERT INTO vault_provider_uses ("providerId", "uses", "capCents", "models", "setBy", "setAt") VALUES (?, ?, ?, ?, ?, ?)`,
    str(p, "id"), JSON.stringify(uses), cap, was ? str(was, "models") || "[]" : "[]", me(ctx), ctx.now());
  const said = [uses.teamChats ? "team chats" : "", uses.automations ? "automations" : "", uses.goals ? "goals" : "", uses.agentWork ? "agent work" : ""].filter(Boolean).join(", ") || "nothing";
  record(ctx, str(p, "itemId"), "edited", { detail: `Space account: pays for ${said}${cap !== null ? `, up to ${(cap / 100).toFixed(2)} a month` : ""}` });
  ctx.emit("provider.updated", `entity/${str(p, "id")}`, { providerId: str(p, "id") }, { vis: "participants" });
}

/**
 * One turn on a Space account the person reaches through its uses, not through the Vault's sharing: the handle and item, never the value, and a "used" line for the person. Null when the handle is
 * no such account, or a team-chats-only account that is not for this person.
 */
export async function useSpaceAccount(ctx: VaultCtx, want: string): Promise<{ handle: string; itemId: string } | null> {
  ensureUses(ctx);
  for (const r of rowsOf(ctx.db.all(`SELECT * FROM vault_provider_uses`))) {
    const p = first(ctx.db.all(`SELECT * FROM vault_provider WHERE "id" = ?`, str(r, "providerId")));
    if (!p || !live(p) || str(p, "scope") !== "shared") continue;
    const item = first(ctx.db.all(`SELECT * FROM vault_meta WHERE "id" = ?`, str(p, "itemId")));
    if (!item || !live(item) || str(item, "handle").replace(/^#/, "").toLowerCase() !== want) continue;
    const uses = parseJson<SpaceUses>(r["uses"], {});
    const who = uses.teamChats?.who;
    const reach = uses.automations === true || uses.goals === true || uses.agentWork !== undefined || who === "everyone" || (who !== undefined && await inGroups(ctx, me(ctx), who));
    if (!reach) return null;
    touch(ctx, item, { purpose: `Space AI account, a turn for ${me(ctx)}` });
    return { handle: str(item, "handle"), itemId: str(item, "id") };
  }
  return null;
}

function ensureKeeps(ctx: VaultCtx): void {
  if (keepsReady.has(ctx.db)) return;
  try { ctx.db.all(`SELECT "providerId" FROM vault_provider_keeps WHERE "providerId" = ?`, "probe"); } catch { for (const s of statements(keepsSql)) ctx.db.run(s); }
  keepsReady.add(ctx.db);
}

/** Does this account keep nothing of what it is sent? A local model always does; any other account does only when an owner or admin said so (false until then). */
export function keepsNothingOf(ctx: VaultCtx, p: Row): boolean {
  if (str(p, "connection") === "local_model") return true;
  ensureKeeps(ctx);
  const r = first(ctx.db.all(`SELECT "keepsNothing" FROM vault_provider_keeps WHERE "providerId" = ?`, str(p, "id")));
  return r !== null && num(r, "keepsNothing") === 1;
}

/** providers.set_keeps_nothing: an owner or admin says an account keeps nothing (or not). Only an account shared with the Space; a local model always keeps nothing and cannot be turned off. */
export function setKeepsNothing(ctx: VaultCtx, p: Row, keepsNothing: unknown): boolean {
  if (typeof keepsNothing !== "boolean") return bad(ctx, "Keeps nothing is yes or no.");
  if (str(p, "connection") === "local_model") { if (!keepsNothing) bad(ctx, "A local model always keeps nothing."); return true; }
  if (str(p, "scope") !== "shared") return bad(ctx, "Only an account shared with the Space can be marked. Your own accounts are not.");
  ensureKeeps(ctx);
  const was = keepsNothingOf(ctx, p);
  ctx.db.run(`DELETE FROM vault_provider_keeps WHERE "providerId" = ?`, str(p, "id"));
  ctx.db.run(`INSERT INTO vault_provider_keeps ("providerId", "keepsNothing", "setBy", "setAt") VALUES (?, ?, ?, ?)`, str(p, "id"), keepsNothing ? 1 : 0, me(ctx), ctx.now());
  if (was !== keepsNothing) {
    record(ctx, str(p, "itemId"), "edited", { detail: keepsNothing ? "Marked as keeping nothing" : "No longer marked as keeping nothing" });
    ctx.emit("provider.keeps_nothing_changed", `entity/${str(p, "id")}`, { providerId: str(p, "id"), keepsNothing }, { vis: "participants" });
  }
  return keepsNothing;
}
