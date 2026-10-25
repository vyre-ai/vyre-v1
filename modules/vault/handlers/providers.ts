// AI providers (spec 2.17, 4.14; ARCH 7.8): the accounts the engine runs a turn on. A provider is an item the Vault holds (an API key or a local model address in a folder, or an ai_subscription sign-in that stays
// Mine) plus a row saying which provider, how it is connected, whose it is and whether the Space may use it. providers.list answers for the person the call acts for, which is how a Mine account of anyone else
// never reaches a turn. The values stay in the items; the engine asks for a handle and the filler fills it. providers.test asks the host to reach the provider (the module has no network of its own) and only
// ever sees the key for that one call.
// DECISION: a Shared provider is an API key or a local model; a subscription sign-in is Mine for ever (the kind cannot be shared). The Space may use a Mine provider only when its owner says so.
import { fail } from "../../../host/src/routes/errors.ts";
import { foldersCreate, itemDelete, itemPut, openFields } from "./items.ts";
import { atLeast, bad, denied, ensure, first, isId, levelOn, newId, num, rowsOf, statements, str } from "../projections.ts";
import type { Row, VaultCtx } from "../projections.ts";
import { hostOf } from "./use.ts";
import { readFileSync } from "node:fs";

export interface CatalogEntry { key: string; name: string; logo?: string; connections: ("subscription" | "api_key" | "local_model")[]; modelsSource: string; engine: string; models?: string[]; instruction?: string }

/** The providers this server knows (the engine drivers). `models` is what a subscription offers when there is no list to read. */
export const CATALOG: readonly CatalogEntry[] = [
  { key: "claude-code", name: "Claude Code", connections: ["subscription"], modelsSource: "static", engine: "claude-code", models: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"], instruction: "On your computer run `claude setup-token`. Vyre saves the token as an AI subscription item in your Mine folder. Then press Done." },
  { key: "codex", name: "Codex", connections: ["subscription"], modelsSource: "static", engine: "codex", models: ["gpt-5-codex"], instruction: "On your computer run `codex login`. Vyre saves the sign-in as an AI subscription item in your Mine folder. Then press Done." },
  { key: "grok", name: "Grok", connections: ["subscription"], modelsSource: "static", engine: "grok", models: ["grok-4"], instruction: "On your computer sign in with the Grok command line. Vyre saves the sign-in as an AI subscription item in your Mine folder. Then press Done." },
  { key: "anthropic", name: "Anthropic", connections: ["api_key"], modelsSource: "https://api.anthropic.com/v1/models", engine: "anthropic" },
  { key: "openai", name: "OpenAI", connections: ["api_key"], modelsSource: "https://api.openai.com/v1/models", engine: "openai" },
  { key: "openrouter", name: "OpenRouter", connections: ["api_key"], modelsSource: "https://openrouter.ai/api/v1/models", engine: "openrouter" },
  { key: "google", name: "Google Gemini", connections: ["api_key"], modelsSource: "https://generativelanguage.googleapis.com/v1beta/models", engine: "google" },
  { key: "xai", name: "xAI", connections: ["api_key"], modelsSource: "https://api.x.ai/v1/models", engine: "xai" },
  { key: "opencode-go", name: "OpenCode Go", connections: ["api_key"], modelsSource: "static", engine: "opencode-go" },
  { key: "local", name: "Local model", connections: ["local_model"], modelsSource: "{address}/v1/models", engine: "local" },
];
const entry = (key: unknown): CatalogEntry | undefined => CATALOG.find((c) => c.key === key);

/** What the host does with a key to see whether the provider takes it (omitted: the module cannot say). */
export interface ProviderProbe { (p: { providerKey: string; connection: string; apiKey?: string; address?: string }): Promise<{ ok: boolean; models: string[]; detail?: string }> }

const providersSql = readFileSync(new URL("../migrations/0003_providers.sql", import.meta.url), "utf8");
const ready = new WeakSet<object>();
function ensureProviders(ctx: VaultCtx): void {
  ensure(ctx);
  if (ready.has(ctx.db)) return;
  try { ctx.db.all(`SELECT "id" FROM vault_provider WHERE "id" = ?`, "probe"); } catch { for (const s of statements(providersSql)) ctx.db.run(s); }
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

function rowOut(ctx: VaultCtx, p: Row): Record<string, unknown> {
  const c = entry(str(p, "providerKey"));
  const item = itemOf(ctx, str(p, "itemId"));
  return {
    id: str(p, "id"), providerKey: str(p, "providerKey"), name: c?.name ?? str(p, "providerKey"), ...(c?.logo ? { logo: c.logo } : {}),
    connection: str(p, "connection"), via: viaOf(str(p, "connection"), str(p, "scope")), scope: str(p, "scope"), itemId: str(p, "itemId"),
    ...(item && str(item, "handle") ? { handle: str(item, "handle") } : {}), agentsUsing: [],
    usage: { tokens: 0, costCents: 0, periodStart: monthStart(ctx.now()) }, engine: c?.engine ?? str(p, "providerKey"),
    spaceMayUse: num(p, "spaceMayUse") === 1, state: str(p, "state"),
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
  void ctx;
  return { providers: CATALOG.map((c) => ({ key: c.key, name: c.name, ...(c.logo ? { logo: c.logo } : {}), connections: c.connections, modelsSource: c.modelsSource, engine: c.engine })) };
}

export async function list(ctx: VaultCtx, _input: Record<string, never>) {
  ensureProviders(ctx);
  const out: Record<string, unknown>[] = [];
  for (const p of rowsOf(ctx.db.all(`SELECT * FROM vault_provider`)).filter(live).sort((a, b) => num(a, "createdAt") - num(b, "createdAt") || str(a, "id").localeCompare(str(b, "id")))) {
    if (!itemOf(ctx, str(p, "itemId"))) continue;
    if (str(p, "scope") === "mine") { if (str(p, "owner") !== me(ctx)) continue; }
    else if (str(p, "owner") !== me(ctx) && !atLeast(levelOn(ctx, "vault_item", str(p, "itemId")), "use")) continue;
    out.push(rowOut(ctx, p));
  }
  return { providers: out };
}

// ---- add and remove

async function mineFolder(ctx: VaultCtx): Promise<string> {
  const have = rowsOf(ctx.db.all(`SELECT * FROM vault_folder`)).find((f) => live(f) && str(f, "scope") === "mine" && str(f, "owner") === ctx.principal.id && str(f, "name") === "AI providers");
  if (have) return str(have, "id");
  return str((await foldersCreate(ctx, { name: "AI providers", scope: "mine", idempotencyKey: `ai-providers-${ctx.principal.id}` })).folder as unknown as Row, "id");
}

export async function add(ctx: VaultCtx, input: { providerKey: string; connection: string; scope: string; apiKey?: string; address?: string; folderId?: string; idempotencyKey: string }) {
  ensureProviders(ctx);
  const c = entry(input.providerKey);
  if (!c) return bad(ctx, "That provider is not known.");
  if (input.connection !== "api_key" && input.connection !== "local_model") return bad(ctx, "Add a key or a local model here; a subscription is connected with Sign in.");
  if (!c.connections.includes(input.connection)) return bad(ctx, `${c.name} does not connect that way.`);
  if (input.scope !== "mine" && input.scope !== "shared") return bad(ctx, "A provider is Mine or Shared.");
  if (input.connection === "api_key" && (typeof input.apiKey !== "string" || input.apiKey.trim() === "")) return bad(ctx, "Paste the key.");
  if (input.connection === "local_model" && (typeof input.address !== "string" || !/^https?:\/\//.test(input.address))) return bad(ctx, "A local model needs its address, like http://localhost:11434.");
  if (input.scope === "shared" && !input.folderId) return bad(ctx, "Choose the shared folder to keep it in.");
  const folderId = input.folderId ?? await mineFolder(ctx);
  const n = rowsOf(ctx.db.all(`SELECT * FROM vault_provider`)).filter((p) => live(p) && str(p, "providerKey") === c.key && str(p, "owner") === me(ctx)).length;
  const made = await itemPut(ctx, {
    folderId, name: n === 0 ? c.name : `${c.name} ${n + 1}`, kind: input.connection === "api_key" ? "api_key" : "other",
    fields: [
      ...(input.apiKey ? [{ key: "api_key", value: input.apiKey.trim(), secret: true }] : []),
      ...(input.address ? [{ key: "address", value: input.address.trim(), secret: false }] : []),
    ], idempotencyKey: `${input.idempotencyKey}:item`,
  } as Parameters<typeof itemPut>[1]);
  const itemId = str((made as unknown as { item: Row }).item, "id");
  const id = newId("prv", ctx.now());
  ctx.db.run(`INSERT INTO vault_provider ("id", "providerKey", "connection", "scope", "owner", "itemId", "spaceMayUse", "state", "createdAt", "deleted_at") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, c.key, input.connection, input.scope, me(ctx), itemId, input.scope === "shared" ? 1 : 0, "ok", ctx.now(), null);
  return rowOut(ctx, providerById(ctx, id));
}

export async function remove(ctx: VaultCtx, input: { providerId: string }) {
  ensureProviders(ctx);
  const p = providerById(ctx, input.providerId);
  mayAct(ctx, p, "manage");
  if (itemOf(ctx, str(p, "itemId"))) await itemDelete(ctx, { itemId: str(p, "itemId") });
  ctx.db.run(`UPDATE vault_provider SET "deleted_at" = ? WHERE "id" = ?`, ctx.now(), str(p, "id"));
  return { ok: true };
}

export async function setSpaceUse(ctx: VaultCtx, input: { providerId: string; allow: boolean }) {
  ensureProviders(ctx);
  if (typeof input.allow !== "boolean") bad(ctx, "Allow is yes or no.");
  const p = providerById(ctx, input.providerId);
  mayAct(ctx, p, "manage");
  if (str(p, "owner") !== me(ctx) && !atLeast(levelOn(ctx, "vault_item", str(p, "itemId")), "manage")) denied(ctx, "Only the owner of a provider says whether the Space may use it.");
  ctx.db.run(`UPDATE vault_provider SET "spaceMayUse" = ? WHERE "id" = ?`, input.allow ? 1 : 0, str(p, "id"));
  return rowOut(ctx, providerById(ctx, str(p, "id")));
}

// ---- subscription sign-in

export async function subscriptionStart(ctx: VaultCtx, input: { providerKey: string; idempotencyKey: string }) {
  ensureProviders(ctx);
  const c = entry(input.providerKey);
  if (!c || !c.connections.includes("subscription")) return bad(ctx, "That provider does not sign in with a subscription.");
  const id = newId("sub", ctx.now());
  ctx.db.run(`INSERT INTO vault_provider_flow ("id", "person", "providerKey", "startedAt", "doneAt") VALUES (?, ?, ?, ?, ?)`, id, me(ctx), c.key, ctx.now(), null);
  return { flowId: id, instruction: c.instruction ?? `Sign in to ${c.name} on your computer, then press Done.` };
}

export async function subscriptionComplete(ctx: VaultCtx, input: { flowId: string }) {
  ensureProviders(ctx);
  if (!isId("sub", input.flowId)) bad(ctx, "Flow id is not valid.");
  const f = first(ctx.db.all(`SELECT * FROM vault_provider_flow WHERE id = ?`, input.flowId));
  if (!f || str(f, "person") !== me(ctx)) throw fail("validation.not_found", ctx.trace.traceId, { message: "That sign-in was not started by you." });
  if (f["doneAt"] !== null) {
    const again = rowsOf(ctx.db.all(`SELECT * FROM vault_provider`)).find((p) => live(p) && str(p, "owner") === me(ctx) && str(p, "providerKey") === str(f, "providerKey"));
    if (again) return rowOut(ctx, again);
  }
  const linked = new Set(rowsOf(ctx.db.all(`SELECT * FROM vault_provider`)).map((p) => str(p, "itemId")));
  const item = rowsOf(ctx.db.all(`SELECT * FROM vault_meta`)).filter((r) => live(r) && str(r, "kind") === "ai_subscription" && str(r, "owner") === me(ctx) && !linked.has(str(r, "id")))
    .filter((r) => num(first(ctx.db.all(`SELECT * FROM vault_item_x WHERE "itemId" = ?`, str(r, "id"))), "createdAt") >= num(f, "startedAt"))
    .sort((a, b) => num(b, "updatedAt") - num(a, "updatedAt"))[0];
  if (!item) throw fail("validation.precondition_failed", ctx.trace.traceId, { message: "The sign-in has not finished yet. Finish it on your computer, then press Done again." });
  const id = newId("prv", ctx.now());
  ctx.db.run(`INSERT INTO vault_provider ("id", "providerKey", "connection", "scope", "owner", "itemId", "spaceMayUse", "state", "createdAt", "deleted_at") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, str(f, "providerKey"), "subscription", "mine", me(ctx), str(item, "id"), 0, "ok", ctx.now(), null);
  ctx.db.run(`UPDATE vault_provider_flow SET "doneAt" = ? WHERE "id" = ?`, ctx.now(), input.flowId);
  return rowOut(ctx, providerById(ctx, id));
}

// ---- test

export async function test(ctx: VaultCtx, input: { providerId: string }) {
  ensureProviders(ctx);
  const p = providerById(ctx, input.providerId);
  mayAct(ctx, p, "use");
  const c = entry(str(p, "providerKey"));
  const item = itemOf(ctx, str(p, "itemId"));
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
    const r = await probe({ providerKey: str(p, "providerKey"), connection: str(p, "connection"), ...(value("api_key") ? { apiKey: value("api_key")! } : {}), ...(value("address") ? { address: value("address")! } : {}) });
    return done(r.ok, r.models, r.detail);
  } catch (e) {
    return done(false, [], e instanceof Error ? e.message.replace(/sk-[A-Za-z0-9_-]+/g, "[key]").slice(0, 200) : "The provider did not answer.");
  }
}

