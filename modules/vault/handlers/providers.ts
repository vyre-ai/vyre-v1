// AI providers (spec 2.17, 4.14; ARCH 7.8): the accounts the engine runs a turn on. A provider is an item the Vault holds (an API key or a local model address in a folder, or an ai_subscription sign-in that stays
// Mine) plus a row saying which provider, how it is connected, whose it is and whether the Space may use it. providers.list answers for the person the call acts for, which is how a Mine account of anyone else
// never reaches a turn. The values stay in the items; the engine asks for a handle and the filler fills it. providers.test asks the host to reach the provider (the module has no network of its own) and only
// ever sees the key for that one call.
// DECISION: a Shared provider is an API key or a local model; a subscription sign-in is Mine for ever (the kind cannot be shared). The Space may use a Mine provider only when its owner says so.
import { fail } from "../../../host/src/routes/errors.ts";
import { itemDelete, itemPut, openFields } from "./items.ts";
import { atLeast, bad, denied, ensure, first, isId, levelOn, newId, num, rowsOf, statements, str } from "../projections.ts";
import type { Row, VaultCtx } from "../projections.ts";
import { hostOf } from "./use.ts";
import type { SigninPort } from "./use.ts";
import { readFileSync } from "node:fs";
import { addressProblem, builtinDefs } from "./provider-defs.ts";
import type { CatalogEntry } from "./provider-defs.ts";

export type { CatalogEntry } from "./provider-defs.ts";

/** The built-in providers this server knows, read from modules/vault/providers/*.json when the module loads (a bad file stops it there). A Space's custom endpoints are rows (customDefs). */
export const CATALOG: readonly CatalogEntry[] = builtinDefs();

function customDefs(ctx: VaultCtx): CatalogEntry[] {
  ensureProviders(ctx);
  return rowsOf(ctx.db.all(`SELECT * FROM vault_provider_def`)).filter(live).map((r) => ({
    key: str(r, "key"), name: str(r, "name"), connections: [num(r, "keyless") === 1 ? "local_model" : "api_key"] as CatalogEntry["connections"], modelsSource: `${str(r, "base")}/models`,
    engine: "custom", base: str(r, "base"), ...(num(r, "keyless") === 1 ? { keyless: true } : {}), models: JSON.parse(str(r, "models")) as string[], custom: true,
  }));
}
/** The definition for a key: a built-in file, else a custom endpoint of this Space. */
const entry = (ctx: VaultCtx, key: unknown): CatalogEntry | undefined => CATALOG.find((c) => c.key === key) ?? customDefs(ctx).find((c) => c.key === key);

/** What the host does with a key to see whether the provider takes it (omitted: the module cannot say). */
export interface ProviderProbe { (p: { providerKey: string; connection: string; caller: string; apiKey?: string; address?: string; engine?: string }): Promise<{ ok: boolean; models: string[]; detail?: string }> }

const providersSql = readFileSync(new URL("../migrations/0003_providers.sql", import.meta.url), "utf8");
const defsSql = readFileSync(new URL("../migrations/0004_provider_defs.sql", import.meta.url), "utf8");
const ready = new WeakSet<object>();
function ensureProviders(ctx: VaultCtx): void {
  ensure(ctx);
  if (ready.has(ctx.db)) return;
  try { ctx.db.all(`SELECT "id" FROM vault_provider WHERE "id" = ?`, "probe"); } catch { for (const s of statements(providersSql)) ctx.db.run(s); }
  try { ctx.db.all(`SELECT "key" FROM vault_provider_def WHERE "key" = ?`, "probe"); } catch { for (const s of statements(defsSql)) ctx.db.run(s); }
  ready.add(ctx.db);
}

const me = (ctx: VaultCtx): string => ctx.actingFor ?? ctx.principal.id;
const monthStart = (now: number): number => { const d = new Date(now); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1); };
const live = (r: Row): boolean => r["deleted_at"] === null || r["deleted_at"] === undefined;

function itemOf(ctx: VaultCtx, itemId: string): Row | null {
  const r = first(ctx.db.all(`SELECT * FROM vault_meta WHERE id = ?`, itemId));
  return r && live(r) ? r : null;
}

function viaOf(connection: string, scope: string): string {
  if (connection === "local_model") return "Local model";
  return `${connection === "subscription" ? "Subscription" : "API key"}, ${scope === "mine" ? "yours" : "shared"}`;
}

function rowOut(ctx: VaultCtx, p: Row, used?: { tokens: number; costCents: number }): Record<string, unknown> {
  const c = entry(ctx, str(p, "providerKey"));
  const item = itemOf(ctx, str(p, "itemId"));
  const address = first(ctx.db.all(`SELECT "address" FROM vault_provider_extra WHERE "providerId" = ?`, str(p, "id")));
  return {
    id: str(p, "id"), providerKey: str(p, "providerKey"), name: c?.name ?? str(p, "providerKey"), ...(c?.logo ? { logo: c.logo } : {}),
    connection: str(p, "connection"), via: viaOf(str(p, "connection"), str(p, "scope")), scope: str(p, "scope"), itemId: str(p, "itemId"),
    ...(item && str(item, "handle") ? { handle: str(item, "handle") } : {}), agentsUsing: [],
    usage: { tokens: used?.tokens ?? 0, costCents: used?.costCents ?? 0, periodStart: monthStart(ctx.now()) }, engine: c?.engine ?? str(p, "providerKey"),
    spaceMayUse: num(p, "spaceMayUse") === 1, state: str(p, "state"),
    ...(address ? { address: str(address, "address") } : {}), ...(c?.keyless || str(p, "connection") === "local_model" ? { keyless: true } : {}),
  };
}

/** The provider the caller may see, or a not-found: a Mine provider is its owner's alone. */
function mayAct(ctx: VaultCtx, p: Row, need: "use" | "manage"): void {
  if (str(p, "scope") === "mine") {
    if (str(p, "owner") !== me(ctx)) throw fail("validation.not_found", ctx.trace.traceId, { message: "That provider is not in this Vault." });
    return;
  }
  if (str(p, "owner") === me(ctx)) return;
  if (!atLeast(levelOn(ctx, "vault_item", str(p, "itemId")), need)) throw fail("validation.not_found", ctx.trace.traceId, { message: "That provider is not in this Vault." });
}

function providerById(ctx: VaultCtx, id: unknown): Row {
  if (!isId("prv", id)) return bad(ctx, "Provider id is not valid.");
  const p = first(ctx.db.all(`SELECT * FROM vault_provider WHERE id = ?`, id));
  if (!p || !live(p)) throw fail("validation.not_found", ctx.trace.traceId, { message: "That provider is not in this Vault." });
  return p;
}

// ---- reads

export async function catalog(ctx: VaultCtx, _input: Record<string, never>) {
  return { providers: [...CATALOG, ...customDefs(ctx)].map((c) => ({ key: c.key, name: c.name, ...(c.logo ? { logo: c.logo } : {}), connections: c.connections, modelsSource: c.modelsSource, engine: c.engine, ...(c.custom ? { custom: true } : {}), ...(c.base ? { base: c.base } : {}) })) };
}

/** This month's tokens and cost on an account, from the turns the engine metered on its item (the person sees their own). Zero when the engine does not answer. */
async function usageThisMonth(ctx: VaultCtx, itemId: string): Promise<{ tokens: number; costCents: number }> {
  try {
    const r = (await ctx.call("engine.usage.query", { by: "agent", itemId, from: monthStart(ctx.now()) })) as { totals?: { tokensIn?: number; tokensOut?: number; costMicros?: number } } | null;
    return { tokens: (r?.totals?.tokensIn ?? 0) + (r?.totals?.tokensOut ?? 0), costCents: Math.round((r?.totals?.costMicros ?? 0) / 10_000) };
  } catch { return { tokens: 0, costCents: 0 }; }
}

export async function list(ctx: VaultCtx, _input: Record<string, never>) {
  ensureProviders(ctx);
  const out: Record<string, unknown>[] = [];
  for (const p of rowsOf(ctx.db.all(`SELECT * FROM vault_provider`)).filter(live).sort((a, b) => num(a, "createdAt") - num(b, "createdAt") || str(a, "id").localeCompare(str(b, "id")))) {
    if (!itemOf(ctx, str(p, "itemId"))) continue;
    if (str(p, "scope") === "mine") { if (str(p, "owner") !== me(ctx)) continue; }
    else if (str(p, "owner") !== me(ctx) && !atLeast(levelOn(ctx, "vault_item", str(p, "itemId")), "use")) continue;
    out.push(rowOut(ctx, p, await usageThisMonth(ctx, str(p, "itemId"))));
  }
  return { providers: out };
}

// ---- add and remove

async function mineFolder(ctx: VaultCtx): Promise<string> {
  const have = rowsOf(ctx.db.all(`SELECT * FROM vault_folder`)).find((f) => live(f) && str(f, "scope") === "mine" && str(f, "owner") === ctx.principal.id && str(f, "name") === "AI providers");
  if (have) return str(have, "id");
  // made quietly: providers.add declares provider.added and vault.item_created, not vault.folder_created, and the folder is the module's own bookkeeping for the person
  const id = newId("vfd", ctx.now());
  ctx.db.run(`INSERT INTO vault_folder ("id", "name", "parentId", "scope", "owner", "whoCanExport", "createdAt") VALUES (?, ?, ?, ?, ?, ?, ?)`, id, "AI providers", null, "mine", ctx.principal.id, "[]", ctx.now());
  return id;
}

export async function add(ctx: VaultCtx, input: { providerKey: string; connection: string; scope: string; apiKey?: string; address?: string; folderId?: string; idempotencyKey: string }) {
  ensureProviders(ctx);
  const c = entry(ctx, input.providerKey);
  if (!c) return bad(ctx, "That provider is not known.");
  if (input.connection !== "api_key" && input.connection !== "local_model") return bad(ctx, "Add a key or a local model here; a subscription is connected with Sign in.");
  if (!c.connections.includes(input.connection)) return bad(ctx, `${c.name} does not connect that way.`);
  if (input.scope !== "mine" && input.scope !== "shared") return bad(ctx, "A provider is Mine or Shared.");
  if (input.connection === "api_key" && (typeof input.apiKey !== "string" || input.apiKey.trim() === "")) return bad(ctx, "Paste the key.");
  // a custom endpoint carries its own address; a local model is told one
  const address = c.custom ? c.base : input.address;
  if (input.connection === "local_model" && (typeof address !== "string" || !/^https?:\/\//.test(address))) return bad(ctx, "A local model needs its address, like http://localhost:11434.");
  if (address !== undefined) {
    const why = addressProblem(address, input.connection === "api_key") ?? await refusedByHost(ctx, address);
    if (why) return bad(ctx, why);
  }
  if (input.scope === "shared" && !input.folderId) return bad(ctx, "Choose the shared folder to keep it in.");
  const folderId = input.folderId ?? await mineFolder(ctx);
  const n = rowsOf(ctx.db.all(`SELECT * FROM vault_provider`)).filter((p) => live(p) && entry(ctx, str(p, "providerKey"))?.name === c.name && str(p, "owner") === me(ctx)).length;
  const made = await itemPut(ctx, {
    folderId, name: n === 0 ? c.name : `${c.name} ${n + 1}`, kind: input.connection === "api_key" ? "api_key" : "other",
    fields: [
      ...(input.apiKey ? [{ key: "api_key", value: input.apiKey.trim(), secret: true }] : []),
      ...(address ? [{ key: "address", value: address.trim(), secret: false }] : []),
    ], idempotencyKey: `${input.idempotencyKey}:item`,
  } as Parameters<typeof itemPut>[1]);
  const itemId = str((made as unknown as { item: Row }).item, "id");
  const id = newId("prv", ctx.now());
  ctx.db.run(`INSERT INTO vault_provider ("id", "providerKey", "connection", "scope", "owner", "itemId", "spaceMayUse", "state", "createdAt", "deleted_at") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, c.key, input.connection, input.scope, me(ctx), itemId, input.scope === "shared" ? 1 : 0, "ok", ctx.now(), null);
  if (address) ctx.db.run(`INSERT INTO vault_provider_extra ("providerId", "address") VALUES (?, ?)`, id, address.trim());
  ctx.emit("provider.added", `entity/${id}`, { providerId: id, providerKey: c.key, connection: input.connection, scope: input.scope }, { vis: "participants" });
  return { provider: rowOut(ctx, providerById(ctx, id)) };
}

/** The host's network guard says no (link-local always; loopback and private unless this is the caller's own computer). No host, no DNS: the syntax check stands. */
async function refusedByHost(ctx: VaultCtx, address: string): Promise<string | null> {
  const refuse = hostOf()?.refuse;
  return refuse ? refuse({ address, caller: me(ctx) }) : null;
}

export async function remove(ctx: VaultCtx, input: { providerId: string }) {
  ensureProviders(ctx);
  const p = providerById(ctx, input.providerId);
  mayAct(ctx, p, "manage");
  if (itemOf(ctx, str(p, "itemId"))) await itemDelete(ctx, { itemId: str(p, "itemId") });
  ctx.db.run(`UPDATE vault_provider SET "deleted_at" = ? WHERE "id" = ?`, ctx.now(), str(p, "id"));
  ctx.emit("provider.removed", `entity/${str(p, "id")}`, { providerId: str(p, "id") }, { vis: "participants" });
  return { ok: true };
}

export async function setSpaceUse(ctx: VaultCtx, input: { providerId: string; allow: boolean }) {
  ensureProviders(ctx);
  if (typeof input.allow !== "boolean") bad(ctx, "Allow is yes or no.");
  const p = providerById(ctx, input.providerId);
  mayAct(ctx, p, "manage");
  if (str(p, "owner") !== me(ctx) && !atLeast(levelOn(ctx, "vault_item", str(p, "itemId")), "manage")) denied(ctx, "Only the owner of a provider says whether the Space may use it.");
  ctx.db.run(`UPDATE vault_provider SET "spaceMayUse" = ? WHERE "id" = ?`, input.allow ? 1 : 0, str(p, "id"));
  ctx.emit("provider.updated", `entity/${str(p, "id")}`, { providerId: str(p, "id"), spaceMayUse: input.allow }, { vis: "participants" });
  return { provider: rowOut(ctx, providerById(ctx, str(p, "id"))) };
}

// ---- subscription sign-in

export async function subscriptionStart(ctx: VaultCtx, input: { providerKey: string; idempotencyKey: string }) {
  ensureProviders(ctx);
  const c = entry(ctx, input.providerKey);
  if (!c || !c.connections.includes("subscription")) return bad(ctx, "That provider does not sign in with a subscription.");
  // a sign-in is a person's own act: it ends with a credential in their own Mine folder
  if (ctx.principal.kind === "agent") return bad(ctx, "Signing in is something a person does. Ask them to press Sign in.");
  const id = newId("sub", ctx.now());
  const port = hostOf()?.signin;
  if (port?.has(c.key)) {
    let started: Awaited<ReturnType<SigninPort["start"]>>;
    try { started = await port.start({ id, provider: c.key, person: me(ctx) }); } catch (e) { return bad(ctx, e instanceof Error ? e.message : "The sign-in could not start. Try again."); }
    ctx.db.run(`INSERT INTO vault_provider_flow ("id", "person", "providerKey", "startedAt", "doneAt") VALUES (?, ?, ?, ?, ?)`, id, me(ctx), c.key, ctx.now(), null);
    return {
      flowId: id, url: started.url, ...(started.userCode ? { userCode: started.userCode } : {}), needsCode: started.needsCode,
      instruction: started.needsCode ? `Open the sign-in, approve it, then paste the code ${c.name} shows.` : `Open the sign-in and enter the code ${started.userCode ?? ""}. This page finishes by itself.`.replace("  ", " "),
    };
  }
  ctx.db.run(`INSERT INTO vault_provider_flow ("id", "person", "providerKey", "startedAt", "doneAt") VALUES (?, ?, ?, ?, ?)`, id, me(ctx), c.key, ctx.now(), null);
  return { flowId: id, needsCode: false, instruction: c.instruction ?? `Sign in to ${c.name} on your computer, then press Done.` };
}

export async function subscriptionComplete(ctx: VaultCtx, input: { flowId: string; code?: string }) {
  ensureProviders(ctx);
  if (!isId("sub", input.flowId)) bad(ctx, "Flow id is not valid.");
  const f = first(ctx.db.all(`SELECT * FROM vault_provider_flow WHERE id = ?`, input.flowId));
  if (!f || str(f, "person") !== me(ctx)) throw fail("validation.not_found", ctx.trace.traceId, { message: "That sign-in was not started by you." });
  if (ctx.principal.kind === "agent") return bad(ctx, "Signing in is something a person does.");
  if (f["doneAt"] !== null) {
    const again = rowsOf(ctx.db.all(`SELECT * FROM vault_provider`)).find((p) => live(p) && str(p, "owner") === me(ctx) && str(p, "providerKey") === str(f, "providerKey"));
    if (again) return { provider: rowOut(ctx, again) };
  }
  const port = hostOf()?.signin;
  const linked = new Set(rowsOf(ctx.db.all(`SELECT * FROM vault_provider`)).map((p) => str(p, "itemId")));
  /** The person's own sign-in saved since this flow began and not yet linked as a provider (their client saved it, or the flow just did). */
  const saved = (): Row | undefined => rowsOf(ctx.db.all(`SELECT * FROM vault_meta`)).filter((r) => live(r) && str(r, "kind") === "ai_subscription" && str(r, "owner") === me(ctx) && !linked.has(str(r, "id")))
    .filter((r) => num(first(ctx.db.all(`SELECT * FROM vault_item_x WHERE "itemId" = ?`, str(r, "id"))), "createdAt") >= num(f, "startedAt"))
    .sort((a, b) => num(b, "updatedAt") - num(a, "updatedAt"))[0];
  const pasted = typeof input.code === "string" && input.code.trim() !== "";
  // no code, and the sign-in is already saved in Mine by the person's client: the flow is not needed, link what they saved
  if (port?.active(input.flowId) && !pasted && saved()) port.cancel(input.flowId);
  if (port?.active(input.flowId)) {
    const step = await port.step({ id: input.flowId, person: me(ctx), ...(pasted ? { code: input.code as string } : {}) });
    if (step.state === "waiting") return { waiting: true };
    if (step.state === "failed") throw fail("provider.auth_failed", ctx.trace.traceId, { message: step.message });
    // the credential goes straight into the person's own Mine folder; it is not returned to anyone
    const c = entry(ctx, str(f, "providerKey"))!;
    const n = rowsOf(ctx.db.all(`SELECT * FROM vault_provider`)).filter((p) => live(p) && entry(ctx, str(p, "providerKey"))?.name === c.name && str(p, "owner") === me(ctx)).length;
    await itemPut(ctx, { folderId: await mineFolder(ctx), name: n === 0 ? c.name : `${c.name} ${n + 1}`, kind: "ai_subscription", fields: step.fields, idempotencyKey: `${input.flowId}:item` } as Parameters<typeof itemPut>[1]);
  }
  const item = saved();
  if (!item) throw fail("validation.precondition_failed", ctx.trace.traceId, { message: "The sign-in has not finished yet. Finish it, then press Done again." });
  const id = newId("prv", ctx.now());
  ctx.db.run(`INSERT INTO vault_provider ("id", "providerKey", "connection", "scope", "owner", "itemId", "spaceMayUse", "state", "createdAt", "deleted_at") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, str(f, "providerKey"), "subscription", "mine", me(ctx), str(item, "id"), 0, "ok", ctx.now(), null);
  ctx.db.run(`UPDATE vault_provider_flow SET "doneAt" = ? WHERE "id" = ?`, ctx.now(), input.flowId);
  ctx.emit("provider.added", `entity/${id}`, { providerId: id, providerKey: str(f, "providerKey"), connection: "subscription", scope: "mine" }, { vis: "participants" });
  return { provider: rowOut(ctx, providerById(ctx, id)) };
}

// ---- test

export async function test(ctx: VaultCtx, input: { providerId: string }) {
  ensureProviders(ctx);
  const p = providerById(ctx, input.providerId);
  mayAct(ctx, p, "use");
  const c = entry(ctx, str(p, "providerKey"));
  const item = itemOf(ctx, str(p, "itemId"));
  const extra = first(ctx.db.all(`SELECT "address" FROM vault_provider_extra WHERE "providerId" = ?`, str(p, "id")));
  const started = Date.now();
  const done = (ok: boolean, models: string[], detail?: string) => {
    ctx.db.run(`UPDATE vault_provider SET "state" = ? WHERE "id" = ?`, ok ? "ok" : str(p, "connection") === "subscription" ? "needs_sign_in" : "failing", str(p, "id"));
    return { ok, models, latencyMs: Math.max(0, Date.now() - started), ...(detail ? { detail } : {}) };
  };
  if (!item) return done(false, [], "The item that holds this account is gone. Add it again.");
  if (str(p, "connection") === "subscription") {
    // a subscription is proved by a turn; here the sign-in is there and the models are the ones it offers
    return done(true, c?.models ?? []);
  }
  const probe = hostOf()?.probe;
  if (!probe) return done(false, [], "This server cannot reach the provider to test it yet.");
  const fields = await openFields(ctx, item);
  const value = (k: string): string | undefined => fields.find((f) => f.key === k)?.value;
  try {
    const r = await probe({ providerKey: str(p, "providerKey"), connection: str(p, "connection"), caller: me(ctx), ...(value("api_key") ? { apiKey: value("api_key")! } : {}), ...(value("address") ? { address: value("address")! } : extra ? { address: str(extra, "address") } : {}), engine: c?.engine ?? str(p, "providerKey") });
    return done(r.ok, r.models, r.detail);
  } catch (e) {
    return done(false, [], e instanceof Error ? e.message.replace(/sk-[A-Za-z0-9_-]+/g, "[key]").slice(0, 200) : "The provider did not answer.");
  }
}


// ---- custom OpenAI-compatible endpoints (a Space's own definitions)

const slug = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "endpoint";

function defOut(c: CatalogEntry, ctx: VaultCtx): Record<string, unknown> {
  const mine = rowsOf(ctx.db.all(`SELECT * FROM vault_provider`)).filter((p) => live(p) && str(p, "providerKey") === c.key && str(p, "owner") === me(ctx)).length;
  return { key: c.key, name: c.name, base: c.base ?? "", keyless: c.keyless === true, models: c.models ?? [], connected: mine };
}

/** Register an endpoint that speaks Chat Completions (a gateway, vLLM, LiteLLM, a hosted model) and connect it with the caller's key. The base address is checked (https for a key; the host's network guard for the rest). */
export async function customAdd(ctx: VaultCtx, input: { name: string; baseUrl: string; apiKey?: string; models?: string[]; scope: string; folderId?: string; idempotencyKey: string }) {
  ensureProviders(ctx);
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (name === "") return bad(ctx, "Give the endpoint a name.");
  const base = typeof input.baseUrl === "string" ? input.baseUrl.trim().replace(/\/+$/, "") : "";
  const hasKey = typeof input.apiKey === "string" && input.apiKey.trim() !== "";
  const why = addressProblem(base, hasKey) ?? await refusedByHost(ctx, base);
  if (why) return bad(ctx, why);
  if (input.models !== undefined && (!Array.isArray(input.models) || input.models.some((m) => typeof m !== "string" || m.trim() === ""))) return bad(ctx, "Models are a list of names.");
  const taken = new Set([...CATALOG.map((c) => c.key), ...rowsOf(ctx.db.all(`SELECT * FROM vault_provider_def`)).map((r) => str(r, "key"))]);
  const sameBase = rowsOf(ctx.db.all(`SELECT * FROM vault_provider_def`)).find((r) => live(r) && str(r, "base") === base && str(r, "name") === name);
  let key = sameBase ? str(sameBase, "key") : `custom-${slug(name)}`;
  if (!sameBase) for (let n = 2; taken.has(key); n++) key = `custom-${slug(name)}-${n}`;
  if (!sameBase) {
    ctx.db.run(`INSERT INTO vault_provider_def ("key", "name", "base", "keyless", "models", "createdBy", "createdAt", "deleted_at") VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      key, name, base, hasKey ? 0 : 1, JSON.stringify((input.models ?? []).map((m) => m.trim())), me(ctx), ctx.now(), null);
  }
  const added = await add(ctx, { providerKey: key, connection: hasKey ? "api_key" : "local_model", scope: input.scope, ...(hasKey ? { apiKey: input.apiKey! } : {}), ...(input.folderId ? { folderId: input.folderId } : {}), idempotencyKey: input.idempotencyKey });
  return { endpoint: defOut(entry(ctx, key)!, ctx), provider: added.provider };
}

export async function customList(ctx: VaultCtx, _input: Record<string, never>) {
  return { endpoints: customDefs(ctx).map((c) => defOut(c, ctx)) };
}

/** Remove an endpoint definition and the caller's own connections to it. Another person's connection to it stops the removal (they remove theirs first, or the owner of the definition asks them). */
export async function customRemove(ctx: VaultCtx, input: { key: string }) {
  ensureProviders(ctx);
  const def = rowsOf(ctx.db.all(`SELECT * FROM vault_provider_def`)).find((r) => live(r) && str(r, "key") === input.key);
  if (!def) throw fail("validation.not_found", ctx.trace.traceId, { message: "That endpoint is not registered." });
  if (str(def, "createdBy") !== me(ctx)) denied(ctx, "Only the person who registered an endpoint removes it.");
  const using = rowsOf(ctx.db.all(`SELECT * FROM vault_provider`)).filter((p) => live(p) && str(p, "providerKey") === input.key);
  if (using.some((p) => str(p, "owner") !== me(ctx))) throw fail("validation.precondition_failed", ctx.trace.traceId, { message: "Someone else still uses this endpoint. They remove their connection first." });
  for (const p of using) await remove(ctx, { providerId: str(p, "id") });
  ctx.db.run(`UPDATE vault_provider_def SET "deleted_at" = ? WHERE "key" = ?`, ctx.now(), input.key);
  return { ok: true };
}
