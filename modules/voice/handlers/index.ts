// Talk (lib/voice.ts): a person's choices, the keys and the session. What covers a person: their own key, else the Space key while it is on, else nothing and the first-press sheet asks.
// DECISION: a key is validated before anything is written, with the same grant Talk makes every time. A key that fails is never stored.
// DECISION: voice.session mints from the Space key through the host with no asker, so it reads a Shared item with no grant to the member. That is what keeps the key Restricted: members never need Use on it.
import { fail } from "../../../host/src/routes/errors.ts";
import { voiceProvider } from "../../../lib/voice.ts";
import type { VoiceProvider } from "../../../lib/voice.ts";
import { catalog, dropSpace, needHost, ownKeyCount, prefsOf, putPrefs, putSpace, spaceOf } from "../projections.ts";
import type { Prefs, SpaceKey, VoiceCtx } from "../projections.ts";

type Item = { id: string; name: string; handle: string; scope: string; owner: string; folderId?: string };
type Row = Record<string, unknown>;
type Field = { key: string; value: string; secret?: boolean };
const VOICE_FOLDER = "Voice";
const MINE_FOLDER = "Accounts";

const refuse = (ctx: Pick<VoiceCtx, "trace">, message: string, reason?: string): never => { throw fail("validation.precondition_failed", ctx.trace.traceId, { message, ...(reason ? { details: { reason } } : {}) }); };
const bad = (ctx: Pick<VoiceCtx, "trace">, message: string): never => { throw fail("validation.bad_input", ctx.trace.traceId, { message }); };

/** The person a call is about: the person, or the person an agent acts for. */
function who(ctx: VoiceCtx): string {
  if (ctx.principal.kind === "person") return ctx.principal.id;
  if ((ctx.principal.kind === "agent" || ctx.principal.kind === "actor") && ctx.actingFor) return ctx.actingFor;
  throw fail("auth.unauthenticated", ctx.trace.traceId);
}
/** Keys and sessions are a person's press. */
function personOnly(ctx: VoiceCtx): string {
  if (ctx.principal.kind !== "person") throw fail("permission.no_grant", ctx.trace.traceId, { message: "A person adds a key and opens Talk, never an agent. Post the key card instead." });
  return ctx.principal.id;
}
function providerOf(ctx: VoiceCtx, key: string): VoiceProvider {
  const p = voiceProvider(key);
  if (!p) return bad(ctx, "That voice provider is not known. Deepgram is the one Vyre has.");
  return p;
}
function keyFrom(ctx: VoiceCtx, p: VoiceProvider, fields: readonly Field[]): string {
  const value = fields.find((f) => f.key === p.keyField)?.value.trim();
  if (!value) return bad(ctx, "Paste the key.");
  return value;
}
const mayManage = (ctx: VoiceCtx): boolean => ctx.authorize({ perm: "policy.manage", level: "view" }, { type: "space", id: ctx.space }).effect === "allow";

/** The person's own key in the Vault. Only they can list it; an agent acting for them learns of it from the row a press left. */
async function ownItem(ctx: VoiceCtx, p: VoiceProvider): Promise<Item | null> {
  if (ctx.principal.kind !== "person") return null;
  const out = (await ctx.call("vault.items.list", { section: "personal", kind: "api_key", q: p.keyName })) as { items?: Item[] };
  return out.items?.find((i) => i.name === p.keyName && i.scope === "mine" && i.owner === ctx.principal.id) ?? null;
}
async function mineFolder(ctx: VoiceCtx, idem: string): Promise<string> {
  const list = (await ctx.call("vault.folders.list", { scope: "mine" })) as { folders: { id: string; name: string }[] };
  const have = list.folders.find((f) => f.name === MINE_FOLDER) ?? list.folders[0];
  if (have) return have.id;
  return ((await ctx.call("vault.folders.create", { name: MINE_FOLDER, scope: "mine", idempotencyKey: `${idem}:folder` })) as { folder: { id: string } }).folder.id;
}

async function statusFor(ctx: VoiceCtx, person: string, prefs: Prefs): Promise<Row> {
  const p = providerOf(ctx, prefs.provider);
  const own = (await ownItem(ctx, p)) !== null || (ctx.principal.kind !== "person" && prefs.keyItem !== null);
  const space = spaceOf(ctx);
  const spaceOn = space?.on === true;
  return {
    on: prefs.on, provider: prefs.provider, language: prefs.language, model: prefs.model, source: own ? "own" : spaceOn ? "space" : "none", spaceOn, mayManage: mayManage(ctx), providers: catalog(),
  };
}
function spaceOut(ctx: VoiceCtx, s: SpaceKey | null): Row {
  const people = ownKeyCount(ctx);
  if (!s) return { set: false, on: false, peopleOwnKey: people };
  return { set: true, on: s.on, provider: s.provider, itemId: s.keyItem, setBy: s.setBy, checkedAt: s.checkedAt, state: s.state, peopleOwnKey: people };
}

// ---- a person

export async function status(ctx: VoiceCtx, _i: Record<string, never>) {
  const person = who(ctx);
  return statusFor(ctx, person, prefsOf(ctx, person));
}

export async function configure(ctx: VoiceCtx, i: { on?: boolean; provider?: string; language?: string; model?: string }) {
  const person = who(ctx);
  const was = prefsOf(ctx, person);
  const p = providerOf(ctx, i.provider ?? was.provider);
  const language = i.language ?? (i.provider ? p.defaultLanguage : was.language);
  const model = i.model ?? (i.provider ? p.defaultModel : was.model);
  if (!p.languages.some((l) => l.id === language)) bad(ctx, `${p.name} does not offer that language here. It offers ${p.languages.map((l) => l.label).join(", ")}.`);
  if (!p.models.some((m) => m.id === model)) bad(ctx, `${p.name} does not offer that model. It offers ${p.models.map((m) => m.label).join(", ")}.`);
  const next: Prefs = { ...was, on: i.on ?? was.on, provider: p.key, language, model };
  putPrefs(ctx, person, next);
  ctx.emit("voice.configured", `entity/${person}`, { person, on: next.on, provider: next.provider, language: next.language, model: next.model, by: ctx.principal.id }, { vis: "participants" });
  return statusFor(ctx, person, next);
}

export async function connect(ctx: VoiceCtx, i: { provider: string; fields: Field[]; idempotencyKey: string }) {
  const person = personOnly(ctx);
  const p = providerOf(ctx, i.provider);
  const value = keyFrom(ctx, p, i.fields);
  await needHost(ctx).check(ctx, { provider: p.key, apiKey: value });
  const field = { key: p.keyField, value, secret: true };
  const have = await ownItem(ctx, p);
  const item = have ?? ((await ctx.call("vault.item.put", { folderId: await mineFolder(ctx, i.idempotencyKey), name: p.keyName, kind: "api_key", fields: [field], idempotencyKey: `${i.idempotencyKey}:item` })) as { item: Item }).item;
  if (have) await ctx.call("vault.item.update", { itemId: have.id, fieldsSet: [field] });
  const prefs: Prefs = { ...prefsOf(ctx, person), on: true, provider: p.key, keyItem: item.id };
  putPrefs(ctx, person, prefs);
  ctx.emit("voice.connected", `entity/${p.key}`, { scope: "mine", provider: p.key, by: person }, { vis: "participants" });
  return statusFor(ctx, person, prefs);
}

export async function disconnect(ctx: VoiceCtx, _i: Record<string, never>) {
  const person = personOnly(ctx);
  const was = prefsOf(ctx, person);
  const p = providerOf(ctx, was.provider);
  const item = await ownItem(ctx, p);
  if (item) await ctx.call("vault.item.delete", { itemId: item.id });
  const prefs: Prefs = { ...was, keyItem: null };
  putPrefs(ctx, person, prefs);
  ctx.emit("voice.disconnected", `entity/${p.key}`, { scope: "mine", provider: p.key, by: person }, { vis: "participants" });
  return statusFor(ctx, person, prefs);
}

export async function session(ctx: VoiceCtx, _i: Record<string, never>) {
  const person = personOnly(ctx);
  const prefs = prefsOf(ctx, person);
  if (!prefs.on) refuse(ctx, "Talk is off. Turn it on in Settings, AI.", "off");
  const p = providerOf(ctx, prefs.provider);
  const own = await ownItem(ctx, p);
  const space = spaceOf(ctx);
  if (!own && !(space?.on && space.provider === p.key)) refuse(ctx, "Talk needs a key.", "no_key");
  // the person's own use is a use of their item; a Space use is the audit row of this call, with no grant on the item
  const used = own ? ((await ctx.call("vault.use", { item: own.id, fields: [p.keyField], purpose: "Talk" })) as { handle: string }) : null;
  const minted = own
    ? await needHost(ctx).mint(ctx, { provider: p.key, handle: `${used!.handle}.${p.keyField}`, asker: person, own: true })
    : await needHost(ctx).mint(ctx, { provider: p.key, handle: `${space!.handle}.${p.keyField}`, own: false });
  const socket = p.socket({ model: prefs.model, language: prefs.language, token: minted.token });
  return { provider: p.key, url: socket.url, protocols: socket.protocols, source: own ? "own" : "space", expiresIn: Math.max(1, Math.round(minted.expiresIn)) };
}

export async function askKey(ctx: VoiceCtx, i: { scope?: "mine" | "space"; provider?: string }) {
  who(ctx);
  if (!ctx.thread) refuse(ctx, "The key card goes in a chat. Ask in a chat, or press the mic.");
  const p = providerOf(ctx, i.provider ?? prefsOf(ctx, who(ctx)).provider);
  const scope = i.scope ?? "mine";
  await ctx.call("chat.post", { threadId: ctx.thread, body: "", blocks: [{ type: "voice_key", v: 1, data: { provider: p.key, scope } }], idempotencyKey: `voice-key:${ctx.thread}:${scope}:${ctx.now()}` });
  return { ok: true };
}

// ---- the Space

export async function spaceStatus(ctx: VoiceCtx, _i: Record<string, never>) { return spaceOut(ctx, spaceOf(ctx)); }

const label = (ctx: VoiceCtx, type: "vault_folder" | "vault_item", id: string): Promise<unknown> => ctx.call("access.labels.set", { resource: { type, id }, label: "restricted" });

/** The Restricted Shared folder the Space key lives in. A Member's role carries Edit over the Space, so the label is what keeps the key from them, before and after the value goes in. */
async function voiceFolder(ctx: VoiceCtx, idem: string): Promise<string> {
  const list = (await ctx.call("vault.folders.list", { scope: "shared" })) as { folders: { id: string; name: string }[] };
  const id = list.folders.find((f) => f.name === VOICE_FOLDER)?.id ?? ((await ctx.call("vault.folders.create", { name: VOICE_FOLDER, scope: "shared", idempotencyKey: `${idem}:folder` })) as { folder: { id: string } }).folder.id;
  await label(ctx, "vault_folder", id);
  return id;
}

export async function spaceConnect(ctx: VoiceCtx, i: { provider: string; fields: Field[]; idempotencyKey: string }) {
  const person = personOnly(ctx);
  const p = providerOf(ctx, i.provider);
  const value = keyFrom(ctx, p, i.fields);
  await needHost(ctx).check(ctx, { provider: p.key, apiKey: value });
  const field = { key: p.keyField, value, secret: true };
  const was = spaceOf(ctx);
  let item: { id: string; handle: string };
  if (was) {
    await ctx.call("vault.item.update", { itemId: was.keyItem, fieldsSet: [field] });
    item = { id: was.keyItem, handle: was.handle };
  } else {
    const folderId = await voiceFolder(ctx, i.idempotencyKey);
    item = ((await ctx.call("vault.item.put", { folderId, name: p.spaceKeyName, kind: "api_key", fields: [field], spaceOnly: true, idempotencyKey: `${i.idempotencyKey}:item` })) as { item: Item }).item;
    await label(ctx, "vault_item", item.id);
  }
  const next: SpaceKey = { on: true, provider: p.key, keyItem: item.id, handle: item.handle, setBy: person, checkedAt: ctx.now(), state: "ok" };
  putSpace(ctx, next);
  ctx.emit("voice.connected", `entity/${p.key}`, { scope: "space", provider: p.key, by: person }, { vis: "participants" });
  ctx.emit("voice.space_changed", `entity/${person}`, { on: true, by: person });
  return spaceOut(ctx, next);
}

export async function spaceConfigure(ctx: VoiceCtx, i: { on: boolean }) {
  const was = spaceOf(ctx);
  if (!was) return refuse(ctx, "Add a key first. An admin adds it in Console, Voice.");
  const next = { ...was, on: i.on };
  putSpace(ctx, next);
  ctx.emit("voice.space_changed", `entity/${ctx.principal.id}`, { on: i.on, by: ctx.principal.id });
  return spaceOut(ctx, next);
}

export async function spaceCheck(ctx: VoiceCtx, _i: Record<string, never>) {
  const was = spaceOf(ctx);
  if (!was) return refuse(ctx, "No Space key to check.");
  let state: SpaceKey["state"] = "ok";
  try { await needHost(ctx).mint(ctx, { provider: was.provider, handle: `${was.handle}.${providerOf(ctx, was.provider).keyField}`, own: false }); }
  catch (e) {
    if ((e as { code?: string }).code !== "provider.auth_failed") throw e;
    state = "failing";
  }
  const next: SpaceKey = { ...was, checkedAt: ctx.now(), state };
  putSpace(ctx, next);
  ctx.emit("voice.space_checked", `entity/${state}`, { state });
  return spaceOut(ctx, next);
}

export async function spaceDisconnect(ctx: VoiceCtx, _i: Record<string, never>) {
  const was = spaceOf(ctx);
  if (was) await ctx.call("vault.item.delete", { itemId: was.keyItem });
  dropSpace(ctx);
  if (was) ctx.emit("voice.disconnected", `entity/${was.provider}`, { scope: "space", provider: was.provider, by: ctx.principal.id }, { vis: "participants" });
  return spaceOut(ctx, null);
}
