// Vault items (spec 2.17, 3.8; ARCH 7.8): list, get, reveal, history, put, update, move, mark rotated, delete, restore, share and unshare, and the vault folders items live in.
// An item is a name plus KEY=value fields. Mine items (a Mine folder) are sealed under the owner's item key (enc=2); Shared items (a Shared folder) are sealed by the filler (enc=1). Lists and get
// answer names, kinds and field keys, never a value; a value leaves only through vault.item.reveal, which needs View, is logged per actor and named in vault.revealed (field keys only).
// DECISION: a Mine item is invisible to everyone but its owner: an admin with every vault permission still does not see it in a list, cannot get it and cannot reveal it, and the key port gives its key only to the owner.
// DECISION: Shared reveal also needs the role permission vault.reveal (Owner and Admin); an agent never reveals (agents get Use only, spec 2.17), and reveal is rate limited by the host.
// DECISION: lists use the same decision as authorize (every row is probed along the vault ladder), so a list can never show what get would refuse. Sections: personal is my own Mine and Shared items, shared is
// Shared items other people own, space is every Shared item I can see; starred and following belong to spaces and come back empty here.
// DECISION: a Mine item cannot be shared; to share it, move it into a Shared folder (that re-encrypts it under the filler). A subscription sign-in (kind ai_subscription) stays Mine for ever.
// DECISION: Trash keeps the sealed row; restore brings it back whole. Deleting a folder, Space policy, export and import are other packets.
import { fail } from "../../../host/src/routes/errors.ts";
import { ENC_MINE, ENC_SHARED, currentFiller, currentKeyPort, openMine, sealMine, wrapKeyFromPersonKey } from "./crypto.ts";
import type { Field, SealedFields } from "./crypto.ts";
import { NEVER_SHARED, isKind, secretByDefault } from "../kinds/index.ts";
import {
  atLeast, anyItem, bad, denied, ensure, first, handleOf, isId, isInt, keyOf, levelOn, liveFolder, liveItem, list, metaOut, newId, num, obj, pageOf, paging, parseJson, patchMeta, record, refuse, rowsOf, str, strOrNull,
} from "../projections.ts";
import type { Json, Row, VaultCtx } from "../projections.ts";

const FIELD_KEY = /^[A-Za-z][A-Za-z0-9_]*$/;
const MAX_VALUE = 64 * 1024;
const MAX_FIELDS = 200;
const live = (r: Row): boolean => r["deleted_at"] === null || r["deleted_at"] === undefined;

// ---- sealed values

export function filler(ctx: VaultCtx) {
  const f = currentFiller();
  if (!f) throw fail("internal.unavailable", ctx.trace.traceId, { message: "The vault service is not running, so values cannot be read or saved. Restart it from Console." });
  return f;
}

/** The wrap key of the signed-in owner, or a refusal. */
async function ownerWrap(ctx: VaultCtx, owner: string): Promise<Buffer> {
  if (ctx.principal.id !== owner || ctx.principal.kind !== "person") return denied(ctx, "A Mine item belongs to one person. Only they can read or change it.");
  const key = await currentKeyPort()?.personKey(owner);
  if (!key) throw fail("auth.unauthenticated", ctx.trace.traceId, { message: "Your vault key is locked. Sign in again to open your Mine items." });
  return wrapKeyFromPersonKey(key);
}

function sealedOf(ctx: VaultCtx, itemId: string): SealedFields {
  const r = first(ctx.db.all(`SELECT * FROM vault_secret WHERE "itemId" = ?`, itemId));
  if (!r) throw fail("internal.unexpected", ctx.trace.traceId, { message: "This item has no stored value." });
  return {
    enc: num(r, "enc") === ENC_MINE ? ENC_MINE : ENC_SHARED, keyId: str(r, "keyId"), box: parseJson(r["box"], { iv: "", ct: "", tag: "" }), rev: num(r, "rev"),
    ...(strOrNull(r, "wrapped") ? { wrapped: parseJson(r["wrapped"], { iv: "", ct: "", tag: "" }) } : {}),
  };
}

function storeSealed(ctx: VaultCtx, itemId: string, s: SealedFields): void {
  const have = first(ctx.db.all(`SELECT * FROM vault_secret WHERE "itemId" = ?`, itemId));
  if (have) ctx.db.run(`UPDATE vault_secret SET "enc" = ?, "keyId" = ?, "wrapped" = ?, "box" = ?, "rev" = ? WHERE "itemId" = ?`, s.enc, s.keyId, s.wrapped ? JSON.stringify(s.wrapped) : null, JSON.stringify(s.box), s.rev, itemId);
  else ctx.db.run(`INSERT INTO vault_secret ("itemId", "enc", "keyId", "wrapped", "box", "rev") VALUES (?, ?, ?, ?, ?, ?)`, itemId, s.enc, s.keyId, s.wrapped ? JSON.stringify(s.wrapped) : null, JSON.stringify(s.box), s.rev);
}

export async function openFields(ctx: VaultCtx, item: Row): Promise<Field[]> {
  const sealed = sealedOf(ctx, str(item, "id"));
  try {
    if (sealed.enc === ENC_MINE) return openMine(str(item, "id"), sealed, await ownerWrap(ctx, str(item, "owner")));
    return filler(ctx).open(str(item, "id"), sealed);
  } catch (e) {
    if (e instanceof Error && "error" in e) throw e;   // a refusal above
    throw fail("internal.unexpected", ctx.trace.traceId, { message: "This item could not be opened with the keys the vault has." });
  }
}

async function sealFor(ctx: VaultCtx, itemId: string, scope: string, owner: string, fields: Field[], rev: number): Promise<SealedFields> {
  return scope === "mine" ? sealMine(itemId, fields, await ownerWrap(ctx, owner), rev) : filler(ctx).seal(itemId, fields, rev);
}

// ---- visibility

/** Mine items are the owner's alone; anything else is visible when authorize allows Use. */
export function visible(ctx: VaultCtx, r: Row): boolean {
  if (!live(r)) return false;
  if (str(r, "scope") === "mine") return str(r, "owner") === ctx.principal.id;
  return str(r, "owner") === ctx.principal.id || levelOn(ctx, "vault_item", str(r, "id")) !== null;
}

export function levelOf(ctx: VaultCtx, r: Row) {
  return str(r, "owner") === ctx.principal.id ? "manage" as const : levelOn(ctx, "vault_item", str(r, "id"));
}

/** An item the caller can see, at least at `need`; a Mine item of someone else does not exist for them. */
export function reachable(ctx: VaultCtx, id: string, need: "use" | "view" | "edit" | "manage", opts: { trashed?: boolean } = {}): Row {
  if (!isId("vit", id)) bad(ctx, "Item id is not valid.");
  const r = opts.trashed ? anyItem(ctx, id) : liveItem(ctx, id);
  if (str(r, "scope") === "mine" && str(r, "owner") !== ctx.principal.id) throw fail("validation.not_found", ctx.trace.traceId, { message: "That item is not in this Vault." });
  if (!atLeast(levelOf(ctx, r), need)) throw fail("permission.no_grant", ctx.trace.traceId, { message: `That needs ${need} access to the item.` });
  return r;
}

// ---- reads

export async function itemsList(ctx: VaultCtx, input: { section?: string; folder?: string; kind?: string; q?: string; cursor?: string; limit?: number }) {
  ensure(ctx);
  const { cursor, limit } = paging(ctx, obj(input));
  if (input.section !== undefined && !["personal", "shared", "space", "starred", "following"].includes(input.section)) bad(ctx, "That section is not known.");
  if (input.folder !== undefined && !isId("vfd", input.folder)) bad(ctx, "Folder id is not valid.");
  if (input.kind !== undefined && !isKind(input.kind)) bad(ctx, "That kind is not known.");
  if (input.q !== undefined && typeof input.q !== "string") bad(ctx, "The search text is text.");
  const me = ctx.principal.id;
  const seen = rowsOf(ctx.db.all(`SELECT * FROM vault_meta`)).filter((r) => visible(ctx, r));
  const counts = {
    personal: seen.filter((r) => str(r, "owner") === me).length, shared: seen.filter((r) => str(r, "scope") === "shared" && str(r, "owner") !== me).length,
    space: seen.filter((r) => str(r, "scope") === "shared").length, starred: 0, following: 0,
  };
  const wanted = seen.filter((r) => {
    const s = input.section;
    if (s === "personal" && str(r, "owner") !== me) return false;
    if (s === "shared" && !(str(r, "scope") === "shared" && str(r, "owner") !== me)) return false;
    if (s === "space" && str(r, "scope") !== "shared") return false;
    if (s === "starred" || s === "following") return false;
    if (input.folder !== undefined && str(r, "folderId") !== input.folder) return false;
    if (input.kind !== undefined && str(r, "kind") !== input.kind) return false;
    if (input.q && !str(r, "name").toLowerCase().includes(input.q.toLowerCase())) return false;
    return true;
  });
  wanted.sort((a, b) => str(a, "name").toLowerCase().localeCompare(str(b, "name").toLowerCase(), "en") || str(a, "id").localeCompare(str(b, "id")));
  const p = pageOf(wanted, cursor, limit);
  return { items: p.page.map((r) => metaOut(ctx, r)), counts, ...(p.next ? { next: p.next } : {}), total: p.total };
}

export async function itemGet(ctx: VaultCtx, input: { itemId: string }) {
  ensure(ctx);
  const r = reachable(ctx, input.itemId, "use");
  const x = first(ctx.db.all(`SELECT * FROM vault_item_x WHERE "itemId" = ?`, str(r, "id")));
  const secrets = parseJson<Record<string, boolean>>(x?.["secrets"], {});
  return { item: metaOut(ctx, r), fields: parseJson<string[]>(r["fieldKeys"], []).map((key) => ({ key, secret: secrets[key] !== false, hasValue: true })) };
}

export async function itemReveal(ctx: VaultCtx, input: { itemId: string; fields?: string[]; reason?: string }) {
  ensure(ctx);
  const r = reachable(ctx, input.itemId, "view");
  if (ctx.principal.kind === "agent") return denied(ctx, "Agents use values by handle; they never see them.");
  if (input.reason !== undefined && typeof input.reason !== "string") bad(ctx, "The reason is text.");
  if (input.fields !== undefined && (!Array.isArray(input.fields) || input.fields.some((f) => typeof f !== "string" || !FIELD_KEY.test(f)))) bad(ctx, "Field keys are not valid.");
  if (str(r, "scope") === "shared" && str(r, "owner") !== ctx.principal.id && ctx.authorize({ perm: "vault.reveal", level: "view" }, { type: "vault_item", id: str(r, "id") }).effect !== "allow") {
    return denied(ctx, "Revealing a shared value needs the Reveal vault values permission.");
  }
  const all = await openFields(ctx, r);
  const asked = input.fields ?? all.map((f) => f.key);
  const unknown = asked.filter((k) => !all.some((f) => f.key === k));
  if (unknown.length) bad(ctx, `This item has no field ${unknown[0]}.`);
  const picked = all.filter((f) => asked.includes(f.key));
  for (const f of picked) record(ctx, str(r, "id"), "revealed", { field: f.key, ...(input.reason ? { detail: input.reason.slice(0, 200) } : {}) });
  ctx.emit("vault.revealed", `vault_item/${str(r, "id")}`, { itemId: str(r, "id"), fields: picked.map((f) => f.key) }, { vis: "participants" });
  return { fields: picked.map((f) => ({ key: f.key, value: f.value })) };
}

export async function itemHistory(ctx: VaultCtx, input: { itemId: string; cursor?: string; limit?: number }) {
  ensure(ctx);
  const { cursor, limit } = paging(ctx, obj(input));
  const r = reachable(ctx, input.itemId, "edit");
  const rows = rowsOf(ctx.db.all(`SELECT * FROM vault_history WHERE "itemId" = ?`, str(r, "id"))).sort((a, b) => num(b, "at") - num(a, "at") || str(b, "id").localeCompare(str(a, "id")));
  const p = pageOf(rows, cursor, limit);
  const entries = p.page.map((h) => ({
    at: num(h, "at"), actor: parseJson<Json>(h["actor"], {}), action: str(h, "action"),
    ...(strOrNull(h, "onBehalfOf") ? { onBehalfOf: parseJson<Json>(h["onBehalfOf"], {}) } : {}), ...(strOrNull(h, "field") ? { field: str(h, "field") } : {}),
    ...(strOrNull(h, "via") ? { via: str(h, "via") } : {}), ...(strOrNull(h, "detail") ? { detail: str(h, "detail") } : {}),
  }));
  return { entries, ...(p.next ? { next: p.next } : {}), total: p.total };
}

// ---- writes

function cleanFields(ctx: VaultCtx, raw: unknown, what: string): Field[] {
  if (!Array.isArray(raw)) return bad(ctx, `${what} is a list of fields.`);
  if (raw.length > MAX_FIELDS) bad(ctx, `An item holds up to ${MAX_FIELDS} fields.`);
  const seen = new Set<string>();
  return raw.map((f) => {
    const o = obj(f);
    if (typeof o["key"] !== "string" || !FIELD_KEY.test(o["key"])) bad(ctx, "A field key starts with a letter and has letters, digits and underscores.");
    if (typeof o["value"] !== "string") bad(ctx, "A field value is text.");
    if ((o["value"] as string).length > MAX_VALUE) throw fail("validation.too_large", ctx.trace.traceId, { message: "A field value is up to 64 KB." });
    if (o["secret"] !== undefined && typeof o["secret"] !== "boolean") bad(ctx, "secret is true or false.");
    if (seen.has(o["key"] as string)) bad(ctx, `The field ${String(o["key"])} is listed twice.`);
    seen.add(o["key"] as string);
    return { key: o["key"] as string, value: o["value"] as string, secret: o["secret"] === undefined ? secretByDefault(o["key"] as string) : (o["secret"] as boolean) };
  });
}

function nameOf(ctx: VaultCtx, v: unknown): string {
  if (typeof v !== "string" || v.trim() === "" || v.length > 200) return bad(ctx, "An item name is 1 to 200 characters.");
  return v.trim();
}

function nameTaken(ctx: VaultCtx, folderId: string, name: string, except?: string): boolean {
  return rowsOf(ctx.db.all(`SELECT * FROM vault_meta WHERE "folderId" = ?`, folderId)).some((r) => live(r) && str(r, "id") !== except && str(r, "name").toLowerCase() === name.toLowerCase());
}

function uniqueHandle(ctx: VaultCtx, name: string, except?: string): string {
  const base = handleOf(name);
  const taken = new Set(rowsOf(ctx.db.all(`SELECT * FROM vault_meta`)).filter((r) => str(r, "id") !== except).map((r) => str(r, "handle").toLowerCase()));
  let h = base;
  for (let n = 2; taken.has(h.toLowerCase()); n++) h = `${base}_${n}`;
  return h;
}

export async function itemPut(ctx: VaultCtx, input: {
  folderId: string; name: string; kind: string; fields: unknown[]; template?: string; spaceOnly?: boolean; injectIntoDeployments?: boolean; rotateEveryDays?: number; idempotencyKey: string;
}) {
  ensure(ctx);
  keyOf(ctx, input);
  if (!isId("vfd", input.folderId)) bad(ctx, "Folder id is not valid.");
  const name = nameOf(ctx, input.name);
  if (!isKind(input.kind)) bad(ctx, "That kind is not known.");
  const fields = cleanFields(ctx, input.fields, "fields");
  if (fields.length === 0) bad(ctx, "An item needs at least one field.");
  for (const [k, v] of [["spaceOnly", input.spaceOnly], ["injectIntoDeployments", input.injectIntoDeployments]] as const) if (v !== undefined && typeof v !== "boolean") bad(ctx, `${k} is true or false.`);
  if (input.rotateEveryDays !== undefined && (!isInt(input.rotateEveryDays) || input.rotateEveryDays < 1)) bad(ctx, "The rotation reminder is a whole number of days.");
  const folder = liveFolder(ctx, input.folderId);
  const scope = str(folder, "scope") === "mine" ? "mine" : "shared";
  if (scope === "mine" && str(folder, "owner") !== ctx.principal.id) throw fail("validation.not_found", ctx.trace.traceId, { message: "That folder is not in this Vault." });
  if (scope === "shared" && !atLeast(levelOn(ctx, "vault_folder", str(folder, "id")), "edit") && str(folder, "owner") !== ctx.principal.id) return denied(ctx, "Adding to this folder needs edit access.");
  if (scope === "shared" && NEVER_SHARED.has(input.kind)) refuse(ctx, "A subscription sign-in is yours alone. Put it in a Mine folder.");
  if (ctx.principal.kind === "agent" && scope === "mine") return denied(ctx, "An agent cannot put items in someone's Mine folder.");
  if (nameTaken(ctx, str(folder, "id"), name)) throw fail("validation.duplicate", ctx.trace.traceId, { message: "This folder already has an item with that name." });

  const now = ctx.now();
  const id = newId("vit", now);
  const sealed = await sealFor(ctx, id, scope, ctx.principal.id, fields, 1);
  storeSealed(ctx, id, sealed);
  ctx.db.run(
    `INSERT INTO vault_meta ("id", "name", "kind", "folderId", "owner", "scope", "fieldKeys", "handle", "spaceOnly", "injectIntoDeployments", "rotateEveryDays", "version", "updated_at", "updatedAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, name, input.kind, str(folder, "id"), ctx.principal.id, scope, JSON.stringify(fields.map((f) => f.key)), uniqueHandle(ctx, name), input.spaceOnly === true ? 1 : 0, input.injectIntoDeployments === true ? 1 : 0,
    input.rotateEveryDays ?? null, 0, now, now,
  );
  ctx.db.run(`INSERT INTO vault_item_x ("itemId", "createdAt", "secrets") VALUES (?, ?, ?)`, id, now, JSON.stringify(Object.fromEntries(fields.map((f) => [f.key, f.secret]))));
  record(ctx, id, "created");
  ctx.emit("vault.item_created", `vault_item/${id}`, { itemId: id, kind: input.kind, folderId: str(folder, "id"), scope }, { vis: "participants" });
  return { item: metaOut(ctx, liveItem(ctx, id)) };
}

export async function itemUpdate(ctx: VaultCtx, input: {
  itemId: string; name?: string; fieldsSet?: unknown[]; fieldsRemove?: string[]; spaceOnly?: boolean; injectIntoDeployments?: boolean; rotateEveryDays?: number | null;
}) {
  ensure(ctx);
  const r = reachable(ctx, input.itemId, "edit");
  const changed: Record<string, string | number | null> = {};
  const settings: string[] = [];
  if (input.name !== undefined) {
    const name = nameOf(ctx, input.name);
    if (name !== str(r, "name")) {
      if (nameTaken(ctx, str(r, "folderId"), name, str(r, "id"))) throw fail("validation.duplicate", ctx.trace.traceId, { message: "This folder already has an item with that name." });
      changed["name"] = name;
      changed["handle"] = uniqueHandle(ctx, name, str(r, "id"));
      settings.push("name");
    }
  }
  for (const [k, col] of [["spaceOnly", "spaceOnly"], ["injectIntoDeployments", "injectIntoDeployments"]] as const) {
    const v = input[k];
    if (v === undefined) continue;
    if (typeof v !== "boolean") bad(ctx, `${k} is true or false.`);
    if ((v ? 1 : 0) !== num(r, col)) { changed[col] = v ? 1 : 0; settings.push(k); }
  }
  if (input.rotateEveryDays !== undefined) {
    if (input.rotateEveryDays !== null && (!isInt(input.rotateEveryDays) || input.rotateEveryDays < 1)) bad(ctx, "The rotation reminder is a whole number of days, or null to clear it.");
    changed["rotateEveryDays"] = input.rotateEveryDays;
    settings.push("rotateEveryDays");
  }
  const set = input.fieldsSet === undefined ? [] : cleanFields(ctx, input.fieldsSet, "fieldsSet");
  const remove = input.fieldsRemove === undefined ? [] : list(input.fieldsRemove).map((k) => (typeof k === "string" && FIELD_KEY.test(k) ? k : bad(ctx, "Field keys are not valid.")));
  const fieldsChanged: string[] = [];
  if (set.length || remove.length) {
    const have = await openFields(ctx, r);
    let next = have.filter((f) => !remove.includes(f.key));
    for (const k of remove) if (!have.some((f) => f.key === k)) bad(ctx, `This item has no field ${k}.`);
    for (const f of set) next = next.some((n) => n.key === f.key) ? next.map((n) => (n.key === f.key ? f : n)) : [...next, f];
    if (next.length === 0) bad(ctx, "An item needs at least one field.");
    const rev = sealedOf(ctx, str(r, "id")).rev + 1;
    storeSealed(ctx, str(r, "id"), await sealFor(ctx, str(r, "id"), str(r, "scope"), str(r, "owner"), next, rev));
    changed["fieldKeys"] = JSON.stringify(next.map((f) => f.key));
    ctx.db.run(`UPDATE vault_item_x SET "secrets" = ? WHERE "itemId" = ?`, JSON.stringify(Object.fromEntries(next.map((f) => [f.key, f.secret]))), str(r, "id"));
    fieldsChanged.push(...new Set([...set.map((f) => f.key), ...remove]));
    for (const k of fieldsChanged) record(ctx, str(r, "id"), "edited", { field: k });
  }
  if (!fieldsChanged.length && !settings.length) return { item: metaOut(ctx, r) };
  patchMeta(ctx, str(r, "id"), changed);
  if (settings.length) record(ctx, str(r, "id"), "edited", { detail: settings.join(", ") });
  ctx.emit("vault.item_updated", `vault_item/${str(r, "id")}`, { itemId: str(r, "id"), fieldsChanged, settingsChanged: settings }, { vis: "participants" });
  return { item: metaOut(ctx, liveItem(ctx, str(r, "id"))) };
}

export async function itemMove(ctx: VaultCtx, input: { itemId: string; folderId: string }) {
  ensure(ctx);
  const r = reachable(ctx, input.itemId, "manage");
  if (!isId("vfd", input.folderId)) bad(ctx, "Folder id is not valid.");
  const target = liveFolder(ctx, input.folderId);
  if (str(target, "id") === str(r, "folderId")) return { item: metaOut(ctx, r) };
  const to = str(target, "scope") === "mine" ? "mine" : "shared";
  if (to === "mine" && (str(target, "owner") !== ctx.principal.id || str(r, "owner") !== ctx.principal.id)) refuse(ctx, "Only the owner can move an item into their own Mine folder.");
  if (to === "shared" && NEVER_SHARED.has(str(r, "kind") as never)) refuse(ctx, "A subscription sign-in is yours alone. It cannot move to a Shared folder.");
  if (to === "shared" && !atLeast(levelOn(ctx, "vault_folder", str(target, "id")), "edit") && str(target, "owner") !== ctx.principal.id) return denied(ctx, "Adding to that folder needs edit access.");
  if (nameTaken(ctx, str(target, "id"), str(r, "name"), str(r, "id"))) throw fail("validation.duplicate", ctx.trace.traceId, { message: "That folder already has an item with this name." });
  if (to !== str(r, "scope")) {
    // crossing Mine and Shared: open under the old key, seal under the new one. A Mine item can only be opened by its owner, so only they can send it across.
    if (str(r, "owner") !== ctx.principal.id) refuse(ctx, "Only the owner can move a Mine item to a Shared folder.");
    const fields = await openFields(ctx, r);
    const rev = sealedOf(ctx, str(r, "id")).rev + 1;
    storeSealed(ctx, str(r, "id"), await sealFor(ctx, str(r, "id"), to, str(r, "owner"), fields, rev));
  }
  const from = str(r, "folderId");
  patchMeta(ctx, str(r, "id"), { folderId: str(target, "id"), scope: to });
  record(ctx, str(r, "id"), "moved", { detail: `${from} to ${str(target, "id")}` });
  ctx.emit("vault.item_moved", `vault_item/${str(r, "id")}`, { itemId: str(r, "id"), fromFolderId: from, toFolderId: str(target, "id") }, { vis: "participants" });
  // item.moved takes fld_ and vfd_ folders alike (P-CC_28), so a Vault move carries from and to on the shared event too
  ctx.emit("item.moved", `vault_item/${str(r, "id")}`, { resource: { type: "vault_item", id: str(r, "id") }, fromFolderId: from, toFolderId: str(target, "id") });
  return { item: metaOut(ctx, liveItem(ctx, str(r, "id"))) };
}

export async function itemMarkRotated(ctx: VaultCtx, input: { itemId: string }) {
  ensure(ctx);
  const r = reachable(ctx, input.itemId, "edit");
  ctx.db.run(`UPDATE vault_item_x SET "lastRotatedAt" = ? WHERE "itemId" = ?`, ctx.now(), str(r, "id"));
  patchMeta(ctx, str(r, "id"), {});
  record(ctx, str(r, "id"), "rotated");
  ctx.emit("vault.item_rotated", `vault_item/${str(r, "id")}`, { itemId: str(r, "id") }, { vis: "participants" });
  return { item: metaOut(ctx, liveItem(ctx, str(r, "id"))) };
}

export async function itemDelete(ctx: VaultCtx, input: { itemId: string }) {
  ensure(ctx);
  const r = reachable(ctx, input.itemId, "manage");
  patchMeta(ctx, str(r, "id"), { deleted_at: ctx.now() });
  ctx.db.run(`UPDATE vault_item_x SET "deletedBy" = ? WHERE "itemId" = ?`, ctx.principal.id, str(r, "id"));
  record(ctx, str(r, "id"), "deleted");
  ctx.emit("vault.item_deleted", `vault_item/${str(r, "id")}`, { itemId: str(r, "id") }, { vis: "participants" });
  return { ok: true };
}

export async function itemRestore(ctx: VaultCtx, input: { itemId: string }) {
  ensure(ctx);
  const r = reachable(ctx, input.itemId, "manage", { trashed: true });
  if (live(r)) refuse(ctx, "That item is not in Trash.");
  const folder = first(ctx.db.all(`SELECT * FROM vault_folder WHERE id = ?`, str(r, "folderId")));
  if (!folder || !live(folder)) refuse(ctx, "Its folder is gone. Move the item to another folder first.");
  if (nameTaken(ctx, str(r, "folderId"), str(r, "name"))) throw fail("validation.duplicate", ctx.trace.traceId, { message: "This folder already has an item with that name." });
  patchMeta(ctx, str(r, "id"), { deleted_at: null });
  ctx.db.run(`UPDATE vault_item_x SET "deletedBy" = ? WHERE "itemId" = ?`, null, str(r, "id"));
  record(ctx, str(r, "id"), "restored");
  ctx.emit("vault.item_restored", `vault_item/${str(r, "id")}`, { itemId: str(r, "id") }, { vis: "participants" });
  return { item: metaOut(ctx, liveItem(ctx, str(r, "id"))) };
}

// ---- sharing: a thin front over access.share and access.unshare

type ResourceIn = { type: string; id: string };
function shareTarget(ctx: VaultCtx, resource: ResourceIn, need: "view" | "manage"): { row: Row; kind: "vault_item" | "vault_folder" } {
  const r = obj(resource);
  if (r["type"] === "vault_item" && typeof r["id"] === "string") {
    const row = reachable(ctx, r["id"], need);
    return { row, kind: "vault_item" };
  }
  if (r["type"] === "vault_folder" && isId("vfd", r["id"])) {
    const row = liveFolder(ctx, r["id"] as string);
    if (str(row, "scope") === "mine" && str(row, "owner") !== ctx.principal.id) throw fail("validation.not_found", ctx.trace.traceId, { message: "That folder is not in this Vault." });
    return { row, kind: "vault_folder" };
  }
  return bad(ctx, "Share an item or a folder.");
}

export async function share(ctx: VaultCtx, input: { resource: ResourceIn; subject: Json; level: string; idempotencyKey: string }) {
  ensure(ctx);
  const key = keyOf(ctx, input);
  const t = shareTarget(ctx, input.resource, "manage");
  if (t.kind === "vault_item") {
    if (str(t.row, "scope") === "mine") refuse(ctx, "A Mine item is private. Move it to a Shared folder to share it.");
    if (NEVER_SHARED.has(str(t.row, "kind") as never)) refuse(ctx, "A subscription sign-in is never shared.");
  } else {
    if (str(t.row, "scope") === "mine") refuse(ctx, "A Mine folder is private. Make a Shared folder to share items.");
    if (!atLeast(levelOn(ctx, "vault_folder", str(t.row, "id")), "manage") && str(t.row, "owner") !== ctx.principal.id) return denied(ctx, "Sharing a folder needs manage access.");
  }
  await ctx.call("access.share", { resource: { type: t.kind, id: str(t.row, "id") }, subject: input.subject, level: input.level, idempotencyKey: key });
  if (t.kind === "vault_item") record(ctx, str(t.row, "id"), "shared", { detail: `${String(obj(input.subject)["kind"])} ${String(obj(input.subject)["id"])} at ${input.level}` });
  return { granted: true };
}

export async function unshare(ctx: VaultCtx, input: { resource: ResourceIn; subject: Json }) {
  ensure(ctx);
  const t = shareTarget(ctx, input.resource, "manage");
  const out = obj(await ctx.call("access.unshare", { resource: { type: t.kind, id: str(t.row, "id") }, subject: input.subject }));
  const revoked = isInt(out["revoked"]) ? out["revoked"] : 0;
  if (t.kind === "vault_item" && revoked > 0) record(ctx, str(t.row, "id"), "unshared", { detail: `${String(obj(input.subject)["kind"])} ${String(obj(input.subject)["id"])}` });
  return { revoked };
}

// ---- folders

function folderOut(ctx: VaultCtx, f: Row): Json {
  const items = rowsOf(ctx.db.all(`SELECT * FROM vault_meta WHERE "folderId" = ?`, str(f, "id"))).filter((r) => visible(ctx, r)).length;
  const mine = str(f, "owner") === ctx.principal.id;
  const out: Json = {
    id: str(f, "id"), name: str(f, "name"), scope: str(f, "scope"), owner: str(f, "owner"), itemCount: items, whoCanExport: parseJson<unknown[]>(f["whoCanExport"], []),
    yourLevel: mine ? "manage" : (levelOn(ctx, "vault_folder", str(f, "id")) ?? "use"),
  };
  if (strOrNull(f, "parentId")) out["parentId"] = str(f, "parentId");
  return out;
}

export async function foldersList(ctx: VaultCtx, input: { scope?: string }) {
  ensure(ctx);
  if (input.scope !== undefined && input.scope !== "mine" && input.scope !== "shared") bad(ctx, "Scope is mine or shared.");
  const rows = rowsOf(ctx.db.all(`SELECT * FROM vault_folder`)).filter((f) => live(f)
    && (input.scope === undefined || str(f, "scope") === input.scope)
    && (str(f, "scope") === "mine" ? str(f, "owner") === ctx.principal.id : str(f, "owner") === ctx.principal.id || levelOn(ctx, "vault_folder", str(f, "id")) !== null));
  rows.sort((a, b) => str(a, "name").toLowerCase().localeCompare(str(b, "name").toLowerCase(), "en") || str(a, "id").localeCompare(str(b, "id")));
  return { folders: rows.map((f) => folderOut(ctx, f)) };
}

export async function foldersCreate(ctx: VaultCtx, input: { name: string; parentId?: string; scope: string; idempotencyKey: string }) {
  ensure(ctx);
  keyOf(ctx, input);
  const name = nameOf(ctx, input.name);
  if (input.scope !== "mine" && input.scope !== "shared") bad(ctx, "Scope is mine or shared.");
  if (input.parentId !== undefined) {
    if (!isId("vfd", input.parentId)) bad(ctx, "Parent folder id is not valid.");
    const parent = liveFolder(ctx, input.parentId);
    if (str(parent, "scope") !== input.scope) refuse(ctx, "A folder lives in a folder of the same kind, Mine or Shared.");
    if (input.scope === "mine" && str(parent, "owner") !== ctx.principal.id) throw fail("validation.not_found", ctx.trace.traceId, { message: "That folder is not in this Vault." });
    if (input.scope === "shared" && !atLeast(levelOn(ctx, "vault_folder", input.parentId), "edit") && str(parent, "owner") !== ctx.principal.id) return denied(ctx, "Adding to this folder needs edit access.");
  }
  if (ctx.principal.kind === "agent" && input.scope === "mine") return denied(ctx, "An agent cannot make Mine folders for someone.");
  const dup = rowsOf(ctx.db.all(`SELECT * FROM vault_folder`)).some((f) => live(f) && str(f, "scope") === input.scope && (input.scope === "shared" || str(f, "owner") === ctx.principal.id)
    && (strOrNull(f, "parentId") ?? "") === (input.parentId ?? "") && str(f, "name").toLowerCase() === name.toLowerCase());
  if (dup) throw fail("validation.duplicate", ctx.trace.traceId, { message: "There is already a folder with that name here." });
  const id = newId("vfd", ctx.now());
  ctx.db.run(`INSERT INTO vault_folder ("id", "name", "parentId", "scope", "owner", "whoCanExport", "createdAt") VALUES (?, ?, ?, ?, ?, ?, ?)`, id, name, input.parentId ?? null, input.scope, ctx.principal.id, "[]", ctx.now());
  ctx.emit("vault.folder_created", `vault_folder/${id}`, { folderId: id, scope: input.scope }, { vis: "participants" });
  return { folder: folderOut(ctx, liveFolder(ctx, id)) };
}

// ---- the service's own health

export async function serviceHealth(ctx: VaultCtx) {
  void ctx;
  const f = currentFiller();
  if (!f) return { state: "down" as const, detail: "The vault service has no key loaded. Values are safe while it is down; restart it in Console." };
  const started = Date.now();
  try {
    const sealed = f.seal("vit_probe", [{ key: "probe", value: "ok", secret: false }]);
    if (f.open("vit_probe", sealed)[0]?.value !== "ok") throw new Error("probe");
  } catch {
    return { state: "degraded" as const, detail: "The vault service is up but its key does not round-trip." };
  }
  return { state: "healthy" as const, latencyMs: Date.now() - started };
}

