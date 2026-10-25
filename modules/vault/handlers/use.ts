// Vault use by name (spec 2.17; ARCH 6.11, 7.8): vault.use answers a handle and field names, vault.fill puts one value into a place at the last moment, vault.inject_env does that for a folder (vyre run --env),
// vault.export_env makes a .env pull link, and the output scrubber removes a value (and its base64, url, json and hex forms) from what returns to the model.
// DECISION: a value leaves the vault only through fill. The place it goes is a sink the host registers per kind (configureVault); a server with no sink for a kind refuses (internal.unavailable) instead of pretending.
// The one exception is returnValue: a person at View level (never an agent) may ask for the value back; the call is logged as a use like any other.
// DECISION: an export is sealed by the filler when the link is made; the database keeps only the hash of the pull token. exportPull is what the pull route calls; the route itself belongs to the gateway.
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fail } from "../../../host/src/routes/errors.ts";
import type { Field } from "./crypto.ts";
import { currentFiller } from "./crypto.ts";
import { filler, openFields, reachable, visible } from "./items.ts";
import {
  atLeast, bad, denied, ensure, first, isId, levelOn, liveFolder, newId, num, obj, parseJson, patchMeta, record, rowsOf, statements, str,
} from "../projections.ts";
import type { Row, VaultCtx, VaultDb } from "../projections.ts";

const FIELD_KEY = /^[A-Za-z][A-Za-z0-9_]*$/;
const HANDLE = /^#([A-Za-z0-9_]+)(?:\.([A-Za-z][A-Za-z0-9_]*))?$/;
const EXPIRY_MS = { "1h": 3_600_000, "1d": 86_400_000, "7d": 604_800_000 } as const;
type Expiry = keyof typeof EXPIRY_MS;
const EXPIRIES: readonly Expiry[] = ["1h", "1d", "7d"];

// ---- the host's places (sinks)

/** What a sink receives: the value, where it goes (the caller's own reference: a process, a header, a field) and which handle it came from. A sink must not log or keep the value. */
export interface FillSink { (f: { value: string; ref: string; handle: string; field: string; itemId: string }): Promise<void> | void }
/** What the host's seams (connectors, sources, import) read: a Shared item's value by handle, for one call, and RS256 signing with a key that never leaves the vault. */
export interface SecretPort {
  secret(handle: string, space: string): Promise<string>;
  signRs256(handle: string, space: string, data: string): Promise<string>;
  /** The .env text of an export link, once (the route at /exports/<id>?token= calls this; the link is the credential). Throws for every refusal. */
  pullExport(exportId: string, token: string): string;
}
export interface VaultHost {
  sinks: Readonly<Record<string, FillSink>>;
  /** The Space's module database, so the port below can read the vault tables outside a call. */
  db?: VaultDb;
  /** The address people reach this server at, for the pull link of an export (read at call time). */
  origin?(): string;
  /** The module hands the host its SecretPort. */
  provide?(port: SecretPort): void;
}
let host: VaultHost | null = null;
/** The host registers the places a value may be filled into (ruling 31/32); null takes them away. */
export function configureVault(h: VaultHost | null): void {
  host = h;
  if (h?.db && h.provide) h.provide(secretPort(h.db));
}

/** A Shared item's field for the host, by handle. Mine items never come out this way: they open only for their owner's session. */
export function secretPort(db: VaultDb): SecretPort {
  const read = (handle: string): string => {
    ensure({ db });
    const m = HANDLE.exec(handle.startsWith("#") ? handle : `#${handle}`);
    if (!m) throw new Error("A handle looks like #Name or #Name.field.");
    const meta = rowsOf(db.all(`SELECT * FROM vault_meta`)).find((r) => r["deleted_at"] == null && str(r, "scope") === "shared" && str(r, "handle").toLowerCase() === `#${m[1]!}`.toLowerCase());
    if (!meta) throw new Error(`The Vault has no shared item ${handle}.`);
    const row = first(db.all(`SELECT * FROM vault_secret WHERE "itemId" = ?`, str(meta, "id")));
    const f = currentFiller();
    if (!row || !f) throw new Error("The vault service is not running.");
    const fields = f.open(str(meta, "id"), { enc: 1, keyId: str(row, "keyId"), box: parseJson(row["box"], { iv: "", ct: "", tag: "" }), rev: num(row, "rev") });
    const hit = m[2] ? fields.find((x) => x.key === m[2]) : fields.length === 1 ? fields[0] : fields.filter((x) => x.secret).length === 1 ? fields.find((x) => x.secret) : undefined;
    if (!hit) throw new Error(`Name a field after ${handle}.`);
    return hit.value;
  };
  const edge = (): VaultCtx => ({
    space: "", principal: { kind: "service", id: "svc_host" }, trace: { traceId: "0".repeat(32) }, now: Date.now, db,
    emit: () => null, call: () => Promise.reject(new Error("the export route makes no calls")), authorize: () => ({ effect: "deny", reason: "edge", decisionId: "edge" }),
    log: { info: () => undefined, warn: () => undefined },
  });
  return {
    pullExport: (exportId, token) => exportPull(edge(), { exportId, token }),
    secret: async (handle) => read(handle),
    signRs256: async (handle, _space, data) => {
      const raw = read(handle);
      let key = raw;
      try { const j = JSON.parse(raw) as { private_key?: unknown }; if (typeof j.private_key === "string") key = j.private_key; } catch { /* the field is the PEM itself */ }
      return crypto.createSign("RSA-SHA256").update(data).sign(key).toString("base64url");
    },
  };
}

// ---- schema

const exportsSql = readFileSync(fileURLToPath(new URL("../migrations/0002_exports.sql", import.meta.url)), "utf8");
const ready = new WeakSet<object>();
function ensureExports(ctx: VaultCtx): void {
  ensure(ctx);
  if (ready.has(ctx.db)) return;
  try { ctx.db.all(`SELECT "id" FROM vault_export WHERE "id" = ?`, "probe"); } catch { for (const s of statements(exportsSql)) ctx.db.run(s); }
  ready.add(ctx.db);
}

// ---- finding an item by name, handle or id

function itemBy(ctx: VaultCtx, ref: string): Row {
  if (isId("vit", ref)) return reachable(ctx, ref, "use");
  const want = ref.replace(/^#/, "").toLowerCase();
  const rows = rowsOf(ctx.db.all(`SELECT * FROM vault_meta`)).filter((r) => visible(ctx, r));
  const hit = rows.find((r) => str(r, "handle").replace(/^#/, "").toLowerCase() === want) ?? rows.find((r) => str(r, "name").toLowerCase() === ref.trim().toLowerCase());
  if (!hit) throw fail("validation.not_found", ctx.trace.traceId, { message: "That item is not in this Vault, or you cannot use it." });
  return reachable(ctx, str(hit, "id"), "use");
}

const keysOf = (r: Row): string[] => parseJson<string[]>(r["fieldKeys"], []);
const viaOf = (r: Row): "device" | "host" => (str(r, "scope") === "mine" ? "device" : "host");

function touch(ctx: VaultCtx, r: Row, o: { field?: string; purpose?: string }): void {
  const id = str(r, "id");
  record(ctx, id, "used", { ...(o.field ? { field: o.field } : {}), ...(o.purpose ? { detail: o.purpose.slice(0, 200) } : {}) });
  patchMeta(ctx, id, { lastUsedAt: ctx.now() });
  ctx.emit("vault.used", `vault_item/${id}`, { itemId: id, ...(o.field ? { field: o.field } : {}), via: viaOf(r), ...(o.purpose ? { purpose: o.purpose.slice(0, 200) } : {}) }, { vis: "participants" });
}

// ---- vault.use

export async function use(ctx: VaultCtx, input: { item: string; fields?: string[]; purpose?: string }) {
  ensure(ctx);
  if (typeof input.item !== "string" || input.item.trim() === "") bad(ctx, "Name the item to use.");
  if (input.purpose !== undefined && typeof input.purpose !== "string") bad(ctx, "The purpose is text.");
  const r = itemBy(ctx, input.item);
  const have = keysOf(r);
  const wanted = input.fields ?? have;
  if (!Array.isArray(wanted) || wanted.some((f) => typeof f !== "string" || !FIELD_KEY.test(f))) bad(ctx, "Field keys are not valid.");
  const unknown = wanted.filter((k) => !have.includes(k));
  if (unknown.length) bad(ctx, `This item has no field ${unknown[0]}.`);
  touch(ctx, r, input.purpose ? { purpose: input.purpose } : {});
  return { handle: str(r, "handle"), itemId: str(r, "id"), fields: wanted };
}

// ---- vault.fill

function parseHandle(ctx: VaultCtx, handle: unknown): { name: string; field?: string } {
  const m = typeof handle === "string" ? HANDLE.exec(handle) : null;
  if (!m) return bad(ctx, "A handle looks like #Dana_Lawmatics or #Dana_Lawmatics.api_key.");
  return { name: m[1]!, ...(m[2] ? { field: m[2] } : {}) };
}

function pick(ctx: VaultCtx, r: Row, fields: Field[], name?: string): Field {
  if (name) {
    const f = fields.find((x) => x.key === name);
    return f ?? bad(ctx, `This item has no field ${name}.`);
  }
  if (fields.length === 1) return fields[0]!;
  const secrets = fields.filter((f) => f.secret);
  if (secrets.length === 1) return secrets[0]!;
  return bad(ctx, `Name a field after the handle, like ${str(r, "handle")}.${fields[0]?.key ?? "key"}.`);
}

export async function fill(ctx: VaultCtx, input: { handle: string; target: { kind: string; ref: string }; returnValue?: boolean }) {
  ensure(ctx);
  const h = parseHandle(ctx, input.handle);
  const t = obj(input.target);
  if (typeof t["kind"] !== "string" || t["kind"] === "" || typeof t["ref"] !== "string" || t["ref"] === "") bad(ctx, "Say where the value goes: a kind and a reference.");
  const kind = t["kind"] as string, ref = t["ref"] as string;
  const r = itemBy(ctx, h.name);
  const f = pick(ctx, r, await openFields(ctx, r), h.field);
  const level = levelOn(ctx, "vault_item", str(r, "id"));
  const owner = str(r, "owner") === ctx.principal.id;
  if (input.returnValue === true && (ctx.principal.kind === "agent" || !(owner || atLeast(level, "view")))) return denied(ctx, "Only a person at View level can have the value back. Agents use values by handle.");
  const sink = host?.sinks[kind];
  if (!sink && input.returnValue !== true) throw fail("internal.unavailable", ctx.trace.traceId, { message: `This server has no place to fill ${kind} yet.` });
  if (sink) await sink({ value: f.value, ref, handle: str(r, "handle"), field: f.key, itemId: str(r, "id") });
  touch(ctx, r, { field: f.key });
  return { filled: sink !== undefined, field: f.key, where: viaOf(r), ...(input.returnValue === true ? { value: f.value } : {}) };
}

// ---- vault.inject_env

function folderItems(ctx: VaultCtx, folderId: string): Row[] {
  return rowsOf(ctx.db.all(`SELECT * FROM vault_meta WHERE "folderId" = ?`, folderId)).filter((r) => visible(ctx, r) && atLeast(str(r, "owner") === ctx.principal.id ? "manage" : levelOn(ctx, "vault_item", str(r, "id")), "use"))
    .sort((a, b) => str(a, "name").toLowerCase().localeCompare(str(b, "name").toLowerCase(), "en") || str(a, "id").localeCompare(str(b, "id")));
}

function folderAt(ctx: VaultCtx, folderId: unknown, need: "use" | "view"): Row {
  if (!isId("vfd", folderId)) bad(ctx, "Folder id is not valid.");
  const f = liveFolder(ctx, folderId);
  if (str(f, "scope") === "mine" && str(f, "owner") !== ctx.principal.id) throw fail("validation.not_found", ctx.trace.traceId, { message: "That folder is not in this Vault." });
  if (str(f, "owner") !== ctx.principal.id && !atLeast(levelOn(ctx, "vault_folder", str(f, "id")), need)) return denied(ctx, `That needs ${need} access to the folder.`);
  return f;
}

export async function injectEnv(ctx: VaultCtx, input: { folderId: string; purpose?: string }) {
  ensure(ctx);
  if (input.purpose !== undefined && typeof input.purpose !== "string") bad(ctx, "The purpose is text.");
  const f = folderAt(ctx, input.folderId, "use");
  const items = folderItems(ctx, str(f, "id"));
  const handles: string[] = [], keys: string[] = [];
  for (const r of items) {
    for (const k of keysOf(r)) { handles.push(`${str(r, "handle")}.${k}`); if (!keys.includes(k)) keys.push(k); }
    touch(ctx, r, input.purpose ? { purpose: input.purpose } : {});
  }
  return { handles, keys };
}

// ---- vault.export_env

async function expiryCap(ctx: VaultCtx): Promise<Expiry> {
  try {
    const v = obj(obj(await ctx.call("settings.get", { key: "vault.export_expiry_max" }))["row"])["value"];
    if (typeof v === "string" && (EXPIRIES as readonly string[]).includes(v)) return v as Expiry;
  } catch { /* the setting is not readable: the default life */ }
  return "1d";
}

const sha = (s: string): string => crypto.createHash("sha256").update(s).digest("hex");

export async function exportEnv(ctx: VaultCtx, input: { folderId: string; expiresIn: string; itemIds?: string[]; idempotencyKey?: string }) {
  ensureExports(ctx);
  if (!(EXPIRIES as readonly string[]).includes(input.expiresIn)) bad(ctx, "A pull link lasts 1 hour, 1 day or 7 days.");
  if (input.itemIds !== undefined && (!Array.isArray(input.itemIds) || input.itemIds.some((i) => !isId("vit", i)))) bad(ctx, "Item ids are not valid.");
  const cap = await expiryCap(ctx);
  if (EXPIRIES.indexOf(input.expiresIn as Expiry) > EXPIRIES.indexOf(cap)) throw fail("validation.precondition_failed", ctx.trace.traceId, { message: `This Space limits pull links to ${cap}.` });
  const f = folderAt(ctx, input.folderId, "use");
  let items = folderItems(ctx, str(f, "id"));
  if (input.itemIds) items = items.filter((r) => input.itemIds!.includes(str(r, "id")));
  const lines: string[] = [], used = new Set<string>();
  for (const r of items) {
    for (const fld of await openFields(ctx, r)) {
      const name = used.has(fld.key) ? `${str(r, "handle").replace(/^#/, "")}__${fld.key}` : fld.key;
      used.add(fld.key);
      lines.push(`${name}=${JSON.stringify(fld.value)}`);
    }
  }
  const id = newId("vex", ctx.now()), token = crypto.randomBytes(24).toString("base64url");
  const sealed = filler(ctx).seal(id, [{ key: "env", value: lines.join("\n") + (lines.length ? "\n" : ""), secret: true }]);
  const expiresAt = ctx.now() + EXPIRY_MS[input.expiresIn as Expiry];
  ctx.db.run(
    `INSERT INTO vault_export ("id", "folderId", "by", "createdAt", "expiresAt", "tokenHash", "box", "keyId", "itemCount", "pulledAt", "revokedAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, str(f, "id"), ctx.principal.id, ctx.now(), expiresAt, sha(token), JSON.stringify(sealed.box), sealed.keyId, items.length, null, null,
  );
  for (const r of items) record(ctx, str(r, "id"), "exported", { detail: `pull link ${input.expiresIn}` });
  ctx.emit("vault.exported", `vault_folder/${str(f, "id")}`, { exportId: id, folderId: str(f, "id"), itemCount: items.length, expiresAt }, { vis: "participants" });
  return { exportId: id, pullUrl: `${(host?.origin?.() ?? "https://vault.invalid").replace(/\/$/, "")}/exports/${id}?token=${token}`, expiresAt };
}

/** The pull route calls this with the id and token from the link: the .env text once, then never again (lead decision: a link is single use, durably). pulledAt is written in the same step as the read. */
export function exportPull(ctx: VaultCtx, input: { exportId: string; token: string }): string {
  ensureExports(ctx);
  const gone = (): never => { throw fail("validation.not_found", ctx.trace.traceId, { message: "This link is closed or has expired." }); };
  const r = first(ctx.db.all(`SELECT * FROM vault_export WHERE "id" = ?`, String(input.exportId)));
  if (!r || r["revokedAt"] !== null || r["pulledAt"] !== null || num(r, "expiresAt") <= ctx.now()) return gone();
  const a = Buffer.from(sha(String(input.token))), b = Buffer.from(str(r, "tokenHash"));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return gone();
  const fields = filler(ctx).open(str(r, "id"), { enc: 1, keyId: str(r, "keyId"), box: parseJson(r["box"], { iv: "", ct: "", tag: "" }), rev: 1 });
  // claim the link first: the UPDATE only matches an unpulled row, so two pulls at once cannot both read it
  if (ctx.db.run(`UPDATE vault_export SET "pulledAt" = ? WHERE "id" = ? AND "pulledAt" IS NULL`, ctx.now(), str(r, "id")).changes !== 1) return gone();
  return fields[0]?.value ?? "";
}

export async function exportsList(ctx: VaultCtx, input: { folderId?: string }) {
  ensureExports(ctx);
  if (input.folderId !== undefined && !isId("vfd", input.folderId)) bad(ctx, "Folder id is not valid.");
  const rows = rowsOf(ctx.db.all(`SELECT * FROM vault_export`)).filter((r) => r["revokedAt"] === null && num(r, "expiresAt") > ctx.now() && (input.folderId === undefined || str(r, "folderId") === input.folderId));
  rows.sort((a, b) => num(b, "createdAt") - num(a, "createdAt") || str(a, "id").localeCompare(str(b, "id")));
  return { exports: rows.map((r) => ({ id: str(r, "id"), folderId: str(r, "folderId"), by: str(r, "by"), expiresAt: num(r, "expiresAt"), pulled: r["pulledAt"] !== null })) };
}

export async function exportsRevoke(ctx: VaultCtx, input: { exportId: string }) {
  ensureExports(ctx);
  if (!isId("vex", input.exportId)) bad(ctx, "Export id is not valid.");
  const r = first(ctx.db.all(`SELECT * FROM vault_export WHERE "id" = ?`, input.exportId));
  if (!r) throw fail("validation.not_found", ctx.trace.traceId, { message: "That export does not exist." });
  if (r["revokedAt"] === null) {
    ctx.db.run(`UPDATE vault_export SET "revokedAt" = ? WHERE "id" = ?`, ctx.now(), input.exportId);
    ctx.emit("vault.export_revoked", `vault_folder/${str(r, "folderId")}`, { exportId: input.exportId, folderId: str(r, "folderId") }, { vis: "participants" });
  }
  return { ok: true };
}

// ---- vault.report_scrub_miss

export async function reportScrubMiss(ctx: VaultCtx, input: { itemId: string; place: string; traceId: string }) {
  ensure(ctx);
  if (!isId("vit", input.itemId)) bad(ctx, "Item id is not valid.");
  if (!["terminal", "http", "browser", "file", "chat"].includes(input.place)) bad(ctx, "That place is not known.");
  if (typeof input.traceId !== "string" || !/^[0-9a-f]{32}$/.test(input.traceId)) bad(ctx, "The trace id is not valid.");
  ctx.log.warn("vault.scrub_miss", { itemId: input.itemId, place: input.place, traceId: input.traceId });
  ctx.emit("vault.scrub_miss", `vault_item/${input.itemId}`, { itemId: input.itemId, place: input.place, traceId: input.traceId }, { vis: "participants" });
  return { ok: true };
}

// ---- the output scrubber

/** Every form a value takes in an output stream: as is, base64 at the three alignments (standard and url-safe, with and without padding), url-encoded, JSON-escaped and hex. */
export function forms(value: string): string[] {
  const out = new Set<string>([value]);
  const buf = Buffer.from(value, "utf8");
  for (let pad = 0; pad < 3; pad++) {
    const core = Buffer.concat([Buffer.alloc(pad), buf]).toString("base64").replace(/=+$/, "");
    // the characters that mix the padding bytes, or the next byte of the stream, with ours depend on the neighbours: the middle is what an embedded copy always contains
    const head = pad === 0 ? 0 : Math.ceil((pad * 8) / 6), tail = (buf.length + pad) % 3 === 0 ? 0 : 1;
    const mid = core.slice(head, core.length - tail);
    if (mid.length >= 6) { out.add(mid); out.add(mid.replace(/\+/g, "-").replace(/\//g, "_")); }
  }
  out.add(buf.toString("base64")); out.add(buf.toString("base64url"));
  out.add(encodeURIComponent(value)); out.add(encodeURIComponent(value).toLowerCase());
  out.add(JSON.stringify(value).slice(1, -1));
  out.add(buf.toString("hex")); out.add(buf.toString("hex").toUpperCase());
  return [...out].filter((s) => s.length >= 4).sort((a, b) => b.length - a.length);
}

export interface Scrubbed { text: string; replaced: number }
/** Replace every form of every secret in `text`. Values shorter than 4 characters are not scrubbed (they would eat ordinary words). */
export function scrub(text: string, secrets: readonly { handle: string; value: string }[]): Scrubbed {
  let out = text, replaced = 0;
  for (const s of secrets) {
    if (s.value.length < 4) continue;
    for (const form of forms(s.value)) {
      if (!out.includes(form)) continue;
      const parts = out.split(form);
      replaced += parts.length - 1;
      out = parts.join(`[${s.handle}]`);
    }
  }
  return { text: out, replaced };
}

/** The handles whose value (in a form the scrubber knows) is still in `text`: a non-empty answer is a vault.scrub_miss to report. */
export function leaks(text: string, secrets: readonly { handle: string; value: string }[]): string[] {
  return secrets.filter((s) => s.value.length >= 4 && forms(s.value).some((f) => text.includes(f))).map((s) => s.handle);
}

