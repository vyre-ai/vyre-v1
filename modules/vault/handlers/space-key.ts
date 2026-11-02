// The Space AI key (Console, AI, Models and providers): one API key an owner or admin sets for everyone in the Space. Every member and agent runs on it after their own accounts (agent/src/accounts/resolve.ts),
// with no setup, and the model picker lists the models it unlocks for everyone.
// DECISION: the key sits in a Restricted Shared folder, the way Talk's Space key does: a member has no level on it, so no member, agent or process can list, reveal, fill, inject or export it. The engine alone
// uses it for a turn, through providers.space_key.use (an audit row per use) and the host's account lookup, which reads it straight into the request header (host/src/seams/engine-session.ts).
// DECISION: the key is checked before anything is written (the provider's model list, with the key). A key the provider refuses is never stored. The model list it answered is kept and asked again after
// REFRESH_MS when someone reads it, so a picker opening does not reach the provider each time.
import { readFileSync } from "node:fs";
import { fail } from "../../../host/src/routes/errors.ts";
import { bad, denied, first, newId, num, parseJson, patchMeta, record, rowsOf, statements, str } from "../projections.ts";
import type { Row, VaultCtx } from "../projections.ts";
import { itemPut, live, openFields } from "./items.ts";
import { ensureProviders, entry } from "./providers.ts";
import type { CatalogEntry } from "./providers.ts";
import { hostOf, touch } from "./use.ts";

/** How long a model list is trusted before the next read asks the provider again. */
export const REFRESH_MS = 15 * 60_000;
const FOLDER = "Space AI key";
const ROW = "space";

const sql = readFileSync(new URL("../migrations/0005_space_key.sql", import.meta.url), "utf8");
const ready = new WeakSet<object>();
function ensureSpaceKey(ctx: VaultCtx): void {
  ensureProviders(ctx);
  if (ready.has(ctx.db)) return;
  try { ctx.db.all(`SELECT "id" FROM vault_space_key WHERE "id" = ?`, "probe"); } catch { for (const s of statements(sql)) ctx.db.run(s); }
  ready.add(ctx.db);
}

interface Current { rec: Row; provider: Row; item: Row; def: CatalogEntry | undefined }

/** The Space AI key as it stands: its record, its provider row and its item, all live. Null when none is set or what it named is gone. */
function current(ctx: VaultCtx): Current | null {
  ensureSpaceKey(ctx);
  const rec = first(ctx.db.all(`SELECT * FROM vault_space_key WHERE "id" = ?`, ROW));
  if (!rec) return null;
  let provider: Row | null = null;
  try { provider = first(ctx.db.all(`SELECT * FROM vault_provider WHERE "id" = ?`, str(rec, "providerId"))); } catch { return null; }
  if (!provider || !live(provider)) return null;
  const item = first(ctx.db.all(`SELECT * FROM vault_meta WHERE "id" = ?`, str(provider, "itemId")));
  if (!item || !live(item)) return null;
  return { rec, provider, item, def: entry(ctx, str(provider, "providerKey")) };
}

/** The provider row id of the Space AI key, for providers.list (every member lists it) and the engine's account rows. */
export function spaceKeyProviderId(ctx: VaultCtx): string | null {
  try { return current(ctx) ? str(first(ctx.db.all(`SELECT "providerId" FROM vault_space_key WHERE "id" = ?`, ROW)), "providerId") : null; } catch { return null; }
}

const me = (ctx: VaultCtx): string => ctx.actingFor ?? ctx.principal.id;
const mayManage = (ctx: VaultCtx): boolean => ctx.principal.kind === "person" && ctx.authorize({ perm: "policy.manage", level: "view" }, { type: "space", id: ctx.space }).effect === "allow";

function out(ctx: VaultCtx, s: Current | null): Record<string, unknown> {
  if (!s) return { set: false, models: [], mayManage: mayManage(ctx) };
  return {
    set: true, providerKey: str(s.provider, "providerKey"), name: s.def?.name ?? str(s.provider, "providerKey"), providerId: str(s.provider, "id"),
    models: parseJson<string[]>(s.rec["models"], []), state: str(s.rec, "state") === "failing" ? "failing" : "ok",
    setBy: str(s.rec, "setBy"), setAt: num(s.rec, "setAt"), checkedAt: num(s.rec, "checkedAt"), mayManage: mayManage(ctx),
  };
}

type Probed = { ok: boolean; models: string[]; detail?: string };

/** Ask the provider for its models with this key, through the host (the module has no network of its own). Null: this server cannot reach providers. */
async function probe(ctx: VaultCtx, def: CatalogEntry, apiKey: string): Promise<Probed | null> {
  const run = hostOf()?.probe;
  if (!run) return null;
  try {
    return await run({ providerKey: def.key, connection: "api_key", caller: me(ctx), apiKey, ...(def.custom && def.base ? { address: def.base } : {}), engine: def.engine });
  } catch {
    return { ok: false, models: [], detail: "The provider could not be reached." };
  }
}
/** A refusal says the key is wrong; anything else (no answer, a 5xx) says nothing about the key. */
const refusedKey = (r: Probed): boolean => !r.ok && /accept|key/i.test(r.detail ?? "");

/** Ask again for the models of the stored key and keep the answer. A provider that does not answer leaves the last list as it was. */
async function refresh(ctx: VaultCtx, s: Current): Promise<Current> {
  if (!s.def) return s;
  const fields = await openFields(ctx, s.item);
  const value = fields.find((f) => f.key === "api_key")?.value ?? fields.find((f) => f.secret)?.value;
  if (!value) return s;
  const r = await probe(ctx, s.def, value);
  if (r === null) return s;
  if (r.ok) ctx.db.run(`UPDATE vault_space_key SET "models" = ?, "state" = ?, "checkedAt" = ? WHERE "id" = ?`, JSON.stringify(r.models), "ok", ctx.now(), ROW);
  else if (refusedKey(r)) ctx.db.run(`UPDATE vault_space_key SET "state" = ?, "checkedAt" = ? WHERE "id" = ?`, "failing", ctx.now(), ROW);
  else ctx.db.run(`UPDATE vault_space_key SET "checkedAt" = ? WHERE "id" = ?`, ctx.now(), ROW);
  return current(ctx) ?? s;
}

// ---- reads

export async function get(ctx: VaultCtx, input: { refresh?: boolean }) {
  let s = current(ctx);
  if (s && ((input.refresh === true && mayManage(ctx)) || ctx.now() - num(s.rec, "checkedAt") > REFRESH_MS)) s = await refresh(ctx, s);
  return out(ctx, s);
}

// ---- set, replace, remove

/** Soft-delete an item the Space AI key held. The capability is gated on policy.manage, so an admin who did not set it can still replace or remove it. */
function dropItem(ctx: VaultCtx, itemId: string): void {
  const it = first(ctx.db.all(`SELECT * FROM vault_meta WHERE "id" = ?`, itemId));
  if (!it || !live(it)) return;
  patchMeta(ctx, itemId, { deleted_at: ctx.now() });
  record(ctx, itemId, "deleted");
  ctx.emit("vault.item_deleted", `vault_item/${itemId}`, { itemId }, { vis: "participants" });
}
function dropProvider(ctx: VaultCtx, providerId: string): void {
  ctx.db.run(`UPDATE vault_provider SET "deleted_at" = ? WHERE "id" = ?`, ctx.now(), providerId);
  ctx.emit("provider.removed", `entity/${providerId}`, { providerId }, { vis: "participants" });
}

const label = (ctx: VaultCtx, type: "vault_folder", id: string): Promise<unknown> => ctx.call("access.labels.set", { resource: { type, id }, label: "restricted" });

/**
 * The Restricted Shared folder the key lives in: the one it was kept in before, else a new one, made through the host so it is a resource at once and can be labelled. The label is set before the
 * value goes in, and the item inherits it.
 */
async function folderFor(ctx: VaultCtx, idem: string): Promise<string> {
  const was = first(ctx.db.all(`SELECT "folderId" FROM vault_space_key WHERE "id" = ?`, ROW));
  const kept = was ? first(ctx.db.all(`SELECT * FROM vault_folder WHERE "id" = ?`, str(was, "folderId"))) : null;
  const named = rowsOf(ctx.db.all(`SELECT * FROM vault_folder WHERE "name" = ?`, FOLDER)).find((f) => live(f) && str(f, "scope") === "shared");
  const have = kept && live(kept) ? kept : named;
  const id = have ? str(have, "id") : String(((await ctx.call("vault.folders.create", { name: FOLDER, scope: "shared", idempotencyKey: `${idem}:folder` })) as { folder: { id: string } }).folder.id);
  await label(ctx, "vault_folder", id);
  return id;
}

export async function set(ctx: VaultCtx, input: { providerKey: string; apiKey: string; idempotencyKey: string }) {
  ensureSpaceKey(ctx);
  if (ctx.principal.kind !== "person") return denied(ctx, "A person sets the Space AI key, never an agent.");
  const def = entry(ctx, input.providerKey);
  if (!def || !def.connections.includes("api_key") || def.keyless) return bad(ctx, "Choose a provider that takes an API key.");
  const value = typeof input.apiKey === "string" ? input.apiKey.trim() : "";
  if (value === "") return bad(ctx, "Paste the key.");
  // checked first: nothing is written for a key the provider refuses
  const r = await probe(ctx, def, value);
  if (r === null) throw fail("provider.unavailable", ctx.trace.traceId, { message: `This server cannot reach ${def.name} to check the key yet.` });
  if (!r.ok) {
    if (refusedKey(r)) throw fail("provider.auth_failed", ctx.trace.traceId, { message: `${def.name} did not accept that key. Check it and try again.` });
    throw fail("provider.unavailable", ctx.trace.traceId, { message: `${def.name} did not answer. Try again in a moment.` });
  }
  const was = current(ctx);
  const folderId = await folderFor(ctx, input.idempotencyKey);
  // the old item goes first, so the new one takes its name; the probe above already passed, so the put below is not expected to fail
  if (was) dropItem(ctx, str(was.item, "id"));
  // put in this module, as providers.add does, so the value never travels through another call's input; the item is a resource of the Restricted folder when this call commits
  const put = (await itemPut(ctx, {
    folderId, name: `${def.name} for everyone`, kind: "api_key", fields: [{ key: "api_key", value, secret: true }], spaceOnly: true, idempotencyKey: `${input.idempotencyKey}:item`,
  })) as unknown as { item: { id: string } };
  const itemId = String(put.item.id);
  const providerId = newId("prv", ctx.now());
  ctx.db.run(`INSERT INTO vault_provider ("id", "providerKey", "connection", "scope", "owner", "itemId", "spaceMayUse", "state", "createdAt", "deleted_at") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    providerId, def.key, "api_key", "shared", ctx.principal.id, itemId, 1, "ok", ctx.now(), null);
  if (def.custom && def.base) ctx.db.run(`INSERT INTO vault_provider_extra ("providerId", "address") VALUES (?, ?)`, providerId, def.base);
  if (was) dropProvider(ctx, str(was.provider, "id"));
  ctx.db.run(`DELETE FROM vault_space_key WHERE "id" = ?`, ROW);
  ctx.db.run(`INSERT INTO vault_space_key ("id", "providerId", "folderId", "setBy", "setAt", "checkedAt", "models", "state") VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ROW, providerId, folderId, ctx.principal.id, ctx.now(), ctx.now(), JSON.stringify(r.models), "ok");
  ctx.emit("provider.added", `entity/${providerId}`, { providerId, providerKey: def.key, connection: "api_key", scope: "shared" }, { vis: "participants" });
  return out(ctx, current(ctx));
}

/** Clear the record when the provider row it names is removed some other way (providers.remove by the person who set it). */
export function forget(ctx: VaultCtx, providerId: string): void {
  ensureSpaceKey(ctx);
  ctx.db.run(`DELETE FROM vault_space_key WHERE "id" = ? AND "providerId" = ?`, ROW, providerId);
}

export async function remove(ctx: VaultCtx, _input: Record<string, never>) {
  const s = current(ctx);
  if (s) {
    dropItem(ctx, str(s.item, "id"));
    dropProvider(ctx, str(s.provider, "id"));
  }
  ensureSpaceKey(ctx);
  ctx.db.run(`DELETE FROM vault_space_key WHERE "id" = ?`, ROW);
  return out(ctx, null);
}

// ---- the engine's use

/** One turn on the Space AI key: the handle and item, never the value. The use is an audit row for the person the turn is for. */
export async function use(ctx: VaultCtx, input: { handle: string }) {
  const s = current(ctx);
  const want = typeof input.handle === "string" ? input.handle.replace(/^#/, "").split(".")[0]!.toLowerCase() : "";
  if (!s || want === "" || str(s.item, "handle").replace(/^#/, "").toLowerCase() !== want) throw fail("validation.not_found", ctx.trace.traceId, { message: "That is not the Space AI key." });
  touch(ctx, s.item, { purpose: `Space AI key, a turn for ${me(ctx)}` });
  return { handle: str(s.item, "handle"), itemId: str(s.item, "id") };
}

