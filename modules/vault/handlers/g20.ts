// Vault capabilities that were deferred in P-L7_LIVE (P-L7_20): folder rename and delete, generate, health, the Space vault policy, items.match, site rules and the person's own Mine export. Import stays deferred.
// DECISION: no capability here returns a stored value. vault.generate returns the fresh value it just made (never stored); health and match open values inside the call only to compare them and return ids, names and issue names.
// DECISION: health and match look only at items the caller can see; weak and reused need View on the item (a Use-only caller gets stale and rotation_due only), and a locked Mine item is skipped, not refused.
// DECISION: match answers items whose non-secret url, website, site or uri field is the page host or a parent domain of it (login.example.com fits an item for example.com); only http and https pages are matched, and a host the person set to never-fill answers nothing.
// DECISION: the Space policy lives in vault_policy (one row). Folder delete refuses a folder that holds any item row, trashed ones included, or a live child folder.
// DECISION: export_mine is for the person themselves (their own turn, or a turn run for them) with their key unlocked; it covers live Mine items and those removed in the last 30 days, seals the .env text under the filler and gives one single-use pull link, like vault.export_env.
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fail } from "../../../host/src/routes/errors.ts";
import { currentFiller, currentKeyPort } from "./crypto.ts";
import { hostOf } from "./use.ts";
import { foldersList, levelOf, openFields, visible } from "./items.ts";
import { atLeast, bad, denied, ensure, first, isId, levelOn, liveFolder, metaOut, newId, num, obj, parseJson, record, refuse, rowsOf, statements, str, strOrNull } from "../projections.ts";
import type { Json, Row, VaultCtx } from "../projections.ts";
import type { Field } from "./crypto.ts";

const live = (r: Row): boolean => r["deleted_at"] === null || r["deleted_at"] === undefined;
const DAY = 24 * 60 * 60 * 1000;

// ---- tables of this packet

const exportsSql = readFileSync(fileURLToPath(new URL("../migrations/0002_exports.sql", import.meta.url)), "utf8");
const made = new WeakSet<object>();
function ensureG20(ctx: VaultCtx): void {
  ensure(ctx);
  if (made.has(ctx.db)) return;
  try { ctx.db.all(`SELECT "id" FROM vault_export WHERE "id" = ?`, "probe"); } catch { for (const s of statements(exportsSql)) ctx.db.run(s); }
  ctx.db.run(`CREATE TABLE IF NOT EXISTS vault_policy ("id" TEXT PRIMARY KEY, "value" TEXT NOT NULL, "by" TEXT, "at" INTEGER)`);
  ctx.db.run(`CREATE TABLE IF NOT EXISTS vault_site_rule ("id" TEXT PRIMARY KEY, "person" TEXT NOT NULL, "host" TEXT NOT NULL, "neverFill" INTEGER NOT NULL, "neverSave" INTEGER NOT NULL, "at" INTEGER NOT NULL)`);
  made.add(ctx.db);
}

// ---- folders

const SUBJECT_KINDS = ["person", "agent", "actor", "service", "group", "role", "link"];

function canManageFolder(ctx: VaultCtx, f: Row): boolean {
  return str(f, "owner") === ctx.principal.id || atLeast(levelOn(ctx, "vault_folder", str(f, "id")), "manage");
}

function manageable(ctx: VaultCtx, folderId: unknown): Row {
  if (!isId("vfd", folderId)) return bad(ctx, "Folder id is not valid.");
  const f = liveFolder(ctx, folderId);
  if (str(f, "scope") === "mine" && str(f, "owner") !== ctx.principal.id) throw fail("validation.not_found", ctx.trace.traceId, { message: "That folder is not in this Vault." });
  if (!canManageFolder(ctx, f)) return denied(ctx, "That needs manage access to the folder.");
  return f;
}

export async function foldersUpdate(ctx: VaultCtx, input: { folderId: string; name?: string; whoCanExport?: unknown[] }) {
  ensureG20(ctx);
  const f = manageable(ctx, input.folderId);
  const changes: Record<string, string> = {};
  let exportRuleChanged = false;
  if (input.name !== undefined) {
    if (typeof input.name !== "string" || input.name.trim() === "" || input.name.length > 200) bad(ctx, "A folder name is 1 to 200 characters.");
    const name = input.name.trim();
    if (name !== str(f, "name")) {
      const dup = rowsOf(ctx.db.all(`SELECT * FROM vault_folder`)).some((x) => live(x) && str(x, "id") !== str(f, "id") && str(x, "scope") === str(f, "scope")
        && (str(f, "scope") === "shared" || str(x, "owner") === str(f, "owner")) && (strOrNull(x, "parentId") ?? "") === (strOrNull(f, "parentId") ?? "") && str(x, "name").toLowerCase() === name.toLowerCase());
      if (dup) throw fail("validation.duplicate", ctx.trace.traceId, { message: "There is already a folder with that name here." });
      changes["name"] = name;
    }
  }
  if (input.whoCanExport !== undefined) {
    if (!Array.isArray(input.whoCanExport) || input.whoCanExport.length > 100) bad(ctx, "Who can export is a list of up to 100 people, groups or roles.");
    if (str(f, "scope") === "mine") refuse(ctx, "A Mine folder is private. Who can export is a Shared folder rule.");
    const subjects = input.whoCanExport.map((s) => {
      const o = obj(s);
      if (typeof o["kind"] !== "string" || !SUBJECT_KINDS.includes(o["kind"]) || typeof o["id"] !== "string" || o["id"] === "") return bad(ctx, "Each exporter names a kind and an id.");
      return { kind: o["kind"], id: o["id"] };
    });
    const next = JSON.stringify(subjects);
    if (next !== JSON.stringify(parseJson<unknown[]>(f["whoCanExport"], []))) { changes["whoCanExport"] = next; exportRuleChanged = true; }
  }
  if (Object.keys(changes).length) {
    const keys = Object.keys(changes);
    ctx.db.run(`UPDATE vault_folder SET ${keys.map((k) => `"${k}" = ?`).join(", ")} WHERE id = ?`, ...keys.map((k) => changes[k]), str(f, "id"));
    ctx.emit("vault.folder_updated", `vault_folder/${str(f, "id")}`, { folderId: str(f, "id"), exportRuleChanged }, { vis: "participants" });
  }
  const out = obj(await foldersList(ctx, {}))["folders"] as Json[];
  return { folder: out.find((x) => x["id"] === str(f, "id")) ?? bad(ctx, "That folder could not be read back.") };
}

export async function foldersDelete(ctx: VaultCtx, input: { folderId: string }) {
  ensureG20(ctx);
  const f = manageable(ctx, input.folderId);
  const items = rowsOf(ctx.db.all(`SELECT * FROM vault_meta WHERE "folderId" = ?`, str(f, "id")));
  if (items.length) refuse(ctx, items.some(live) ? "This folder still has items. Move or delete them first." : "This folder still holds items in Trash. Restore or move them first.");
  const kids = rowsOf(ctx.db.all(`SELECT * FROM vault_folder WHERE "parentId" = ?`, str(f, "id"))).filter(live);
  if (kids.length) refuse(ctx, "This folder has folders inside it. Delete or move those first.");
  ctx.db.run(`UPDATE vault_folder SET "deleted_at" = ? WHERE id = ?`, ctx.now(), str(f, "id"));
  ctx.emit("vault.folder_deleted", `vault_folder/${str(f, "id")}`, { folderId: str(f, "id") }, { vis: "participants" });
  return { ok: true };
}

// ---- generate

const LOWER = "abcdefghijklmnopqrstuvwxyz", UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ", DIGITS = "0123456789", SYMBOLS = "!@#$%^&*()-_=+[]{};:,.?";
const CONSONANTS = "bdfghjklmnprstvwz", VOWELS = "aeiou";
const pick = (set: string): string => set[crypto.randomInt(set.length)] ?? "";
function shuffle(a: string[]): string[] {
  for (let i = a.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [a[i], a[j]] = [a[j] ?? "", a[i] ?? ""]; }
  return a;
}
const strengthOf = (bits: number): "fair" | "good" | "strong" => (bits < 64 ? "fair" : bits < 100 ? "good" : "strong");

export async function generate(ctx: VaultCtx, input: { kind: string; length?: number; symbols?: boolean; words?: number }) {
  if (input.kind !== "password" && input.kind !== "passphrase" && input.kind !== "token") bad(ctx, "Make a password, a passphrase or a token.");
  if (input.symbols !== undefined && typeof input.symbols !== "boolean") bad(ctx, "symbols is true or false.");
  if (input.length !== undefined && (!Number.isSafeInteger(input.length) || input.length < 8 || input.length > 128)) bad(ctx, "The length is 8 to 128.");
  if (input.words !== undefined && (!Number.isSafeInteger(input.words) || input.words < 3 || input.words > 10)) bad(ctx, "A passphrase has 3 to 10 words.");
  if (input.kind === "passphrase") {
    const n = input.words ?? 6;
    const words = Array.from({ length: n }, () => Array.from({ length: 3 }, () => pick(CONSONANTS) + pick(VOWELS)).join(""));
    return { value: words.join("-"), strength: strengthOf(n * 3 * Math.log2(CONSONANTS.length * VOWELS.length)) };
  }
  const length = input.length ?? (input.kind === "token" ? 32 : 20);
  if (input.kind === "token") return { value: Array.from({ length }, () => pick(LOWER + UPPER + DIGITS)).join(""), strength: strengthOf(length * Math.log2(62)) };
  const sets = input.symbols === false ? [LOWER, UPPER, DIGITS] : [LOWER, UPPER, DIGITS, SYMBOLS];
  const all = sets.join("");
  const chars = [...sets.map(pick), ...Array.from({ length: length - sets.length }, () => pick(all))];
  return { value: shuffle(chars).join(""), strength: strengthOf(length * Math.log2(all.length)) };
}

// ---- health

const COMMON = new Set(["password", "password1", "123456", "12345678", "123456789", "qwerty", "qwerty123", "letmein", "welcome", "admin", "admin123", "iloveyou", "abc123", "changeme", "passw0rd"]);
const classes = (s: string): number => [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(s)).length;
const weakPassword = (s: string): boolean => s.length < 10 || classes(s) < 3 || COMMON.has(s.toLowerCase());
const STALE_AFTER = 365 * DAY;

export async function health(ctx: VaultCtx, input: { folderId?: string }) {
  ensureG20(ctx);
  if (input.folderId !== undefined) {
    if (!isId("vfd", input.folderId)) bad(ctx, "Folder id is not valid.");
    liveFolder(ctx, input.folderId);
  }
  const rows = rowsOf(ctx.db.all(`SELECT * FROM vault_meta`)).filter((r) => visible(ctx, r) && (input.folderId === undefined || str(r, "folderId") === input.folderId));
  const salt = crypto.randomBytes(16);   // reuse is judged by a salted digest held for this call only
  const seen = new Map<string, string[]>();
  const issues = new Map<string, Set<"weak" | "reused" | "stale" | "rotation_due">>();
  const add = (id: string, issue: "weak" | "reused" | "stale" | "rotation_due"): void => { (issues.get(id) ?? issues.set(id, new Set()).get(id))!.add(issue); };
  for (const r of rows) {
    const id = str(r, "id"), kind = str(r, "kind");
    const x = first(ctx.db.all(`SELECT * FROM vault_item_x WHERE "itemId" = ?`, id));
    const base = num(x, "lastRotatedAt") || num(x, "createdAt");
    if (kind !== "note" && base > 0 && ctx.now() - base > STALE_AFTER) add(id, "stale");
    if (typeof r["rotateEveryDays"] === "number" && base > 0 && ctx.now() > base + (r["rotateEveryDays"] as number) * DAY) add(id, "rotation_due");
    if (!atLeast(levelOf(ctx, r), "view") || kind === "note" || kind === "ssh_key" || kind === "ai_subscription") continue;
    let fields: Field[];
    try { fields = await openFields(ctx, r); } catch { continue; }   // a locked Mine item, or a value this node cannot open, is skipped
    for (const f of fields.filter((q) => q.secret && q.value !== "")) {
      if (kind === "login" && weakPassword(f.value)) add(id, "weak");
      const d = crypto.createHmac("sha256", salt).update(f.value).digest("hex");
      seen.set(d, [...(seen.get(d) ?? []), id]);
    }
  }
  for (const ids of seen.values()) { const uniq = [...new Set(ids)]; if (uniq.length > 1) for (const id of uniq) add(id, "reused"); }
  const order = ["weak", "reused", "stale", "rotation_due"] as const;
  const items = rows.filter((r) => issues.has(str(r, "id"))).sort((a, b) => str(a, "name").toLowerCase().localeCompare(str(b, "name").toLowerCase(), "en") || str(a, "id").localeCompare(str(b, "id")))
    .map((r) => ({ itemId: str(r, "id"), name: str(r, "name"), issues: order.filter((o) => issues.get(str(r, "id"))?.has(o)) }));
  const count = (k: (typeof order)[number]): number => items.filter((i) => i.issues.includes(k)).length;
  return { total: rows.length, weak: count("weak"), reused: count("reused"), stale: count("stale"), rotationDue: count("rotation_due"), items };
}

// ---- policy

const PULL_MAX = ["1h", "1d", "7d"];
const DEFAULT_POLICY = { exportRoles: ["owner", "admin"], pullExpiryMax: "1d", blockRestrictedExport: true as const, revealNeedsReason: false };
type Policy = typeof DEFAULT_POLICY & { pullExpiryMax: string };

function readPolicy(ctx: VaultCtx): Policy {
  const r = first(ctx.db.all(`SELECT * FROM vault_policy WHERE "id" = ?`, "space"));
  return { ...DEFAULT_POLICY, ...parseJson<Partial<Policy>>(r?.["value"], {}), blockRestrictedExport: true };
}

export async function policyGet(ctx: VaultCtx) {
  ensureG20(ctx);
  return { policy: readPolicy(ctx) };
}

export async function policySet(ctx: VaultCtx, input: { policy: unknown }) {
  ensureG20(ctx);
  const p = obj(input.policy);
  const roles = p["exportRoles"];
  if (!Array.isArray(roles) || roles.length > 20 || roles.some((x) => typeof x !== "string" || x.trim() === "" || x.length > 64)) bad(ctx, "Export roles is a list of up to 20 role names.");
  if (typeof p["pullExpiryMax"] !== "string" || !PULL_MAX.includes(p["pullExpiryMax"])) bad(ctx, "A pull link lasts at most 1 hour, 1 day or 7 days.");
  if (p["blockRestrictedExport"] !== true) refuse(ctx, "Restricted items are never exported. That rule cannot be turned off.");
  if (typeof p["revealNeedsReason"] !== "boolean") bad(ctx, "revealNeedsReason is true or false.");
  const next: Policy = { exportRoles: [...new Set((roles as string[]).map((x) => x.trim()))], pullExpiryMax: p["pullExpiryMax"] as string, blockRestrictedExport: true, revealNeedsReason: p["revealNeedsReason"] as boolean };
  const have = first(ctx.db.all(`SELECT * FROM vault_policy WHERE "id" = ?`, "space"));
  if (have) ctx.db.run(`UPDATE vault_policy SET "value" = ?, "by" = ?, "at" = ? WHERE "id" = ?`, JSON.stringify(next), ctx.principal.id, ctx.now(), "space");
  else ctx.db.run(`INSERT INTO vault_policy ("id", "value", "by", "at") VALUES (?, ?, ?, ?)`, "space", JSON.stringify(next), ctx.principal.id, ctx.now());
  ctx.emit("policy.changed", "entity/vault.policy", { key: "vault.policy", scope: "space", kind: "vault", by: ctx.principal.id });
  return { policy: next };
}

// ---- match

const USER_KEYS = ["username", "user", "email", "login"];
const URL_KEYS = ["url", "website", "site", "uri"];

/** The host of a page address, lower case; null for anything but http and https. */
function pageHost(address: string): string | null {
  const t = address.trim();
  if (t === "" || t.length > 2048) return null;
  try {
    const u = new URL(/^[A-Za-z][A-Za-z0-9+.-]*:/.test(t) && !/^[^/]*:\d+(\/|$)/.test(t) ? t : `https://${t}`);
    return (u.protocol === "https:" || u.protocol === "http:") && u.hostname !== "" ? u.hostname.toLowerCase() : null;
  } catch { return null; }
}

function siteRule(ctx: VaultCtx, person: string, host: string): Row | null {
  return first(ctx.db.all(`SELECT * FROM vault_site_rule WHERE "id" = ?`, `${person}|${host}`));
}
const personOf = (ctx: VaultCtx): string | null => (ctx.principal.kind === "person" ? ctx.principal.id : ctx.actingFor ?? null);

export async function itemsMatch(ctx: VaultCtx, input: { url: string }) {
  ensureG20(ctx);
  if (typeof input.url !== "string") bad(ctx, "The address is text.");
  const host = pageHost(input.url);
  if (!host) bad(ctx, "Match needs an http or https address.");
  const who = personOf(ctx);
  if (who && siteRule(ctx, who, host as string)?.["neverFill"] === 1) return { items: [] };
  const found: { r: Row; exact: boolean }[] = [];
  for (const r of rowsOf(ctx.db.all(`SELECT * FROM vault_meta`))) {
    if (!visible(ctx, r) || str(r, "kind") === "ai_subscription") continue;
    const keys = parseJson<string[]>(r["fieldKeys"], []);
    if (!keys.some((k) => URL_KEYS.includes(k))) continue;
    let fields: Field[];
    try { fields = await openFields(ctx, r); } catch { continue; }
    const hosts = fields.filter((f) => !f.secret && URL_KEYS.includes(f.key)).map((f) => pageHost(f.value)).filter((h): h is string => h !== null && h.includes("."));
    const hit = hosts.find((h) => h === host || (host as string).endsWith(`.${h}`));
    if (hit) found.push({ r, exact: hit === host });
  }
  found.sort((a, b) => Number(b.exact) - Number(a.exact) || str(a.r, "name").toLowerCase().localeCompare(str(b.r, "name").toLowerCase(), "en") || str(a.r, "id").localeCompare(str(b.r, "id")));
  return {
    items: found.map(({ r }) => {
      const u = parseJson<string[]>(r["fieldKeys"], []).find((k) => USER_KEYS.includes(k));
      return { item: metaOut(ctx, r), ...(u ? { usernameField: u } : {}) };
    }),
  };
}

// ---- site rules

export async function siteRulesList(ctx: VaultCtx) {
  ensureG20(ctx);
  const who = personOf(ctx);
  if (!who) return denied(ctx, "Site rules belong to a person.");
  const sites = rowsOf(ctx.db.all(`SELECT * FROM vault_site_rule WHERE "person" = ?`, who)).sort((a, b) => str(a, "host").localeCompare(str(b, "host")))
    .map((r) => ({ host: str(r, "host"), neverFill: num(r, "neverFill") === 1, neverSave: num(r, "neverSave") === 1, at: num(r, "at") }));
  return { sites };
}

export async function siteRulesSet(ctx: VaultCtx, input: { host: string; neverFill: boolean; neverSave: boolean }) {
  ensureG20(ctx);
  const who = personOf(ctx);
  if (!who) return denied(ctx, "Site rules belong to a person.");
  if (typeof input.neverFill !== "boolean" || typeof input.neverSave !== "boolean") bad(ctx, "neverFill and neverSave are true or false.");
  const host = typeof input.host === "string" ? pageHost(input.host) : null;
  if (!host) return bad(ctx, "Name a site, like bank.example.com.");
  const id = `${who}|${host}`;
  if (!input.neverFill && !input.neverSave) ctx.db.run(`DELETE FROM vault_site_rule WHERE "id" = ?`, id);
  else if (siteRule(ctx, who, host)) ctx.db.run(`UPDATE vault_site_rule SET "neverFill" = ?, "neverSave" = ?, "at" = ? WHERE "id" = ?`, input.neverFill ? 1 : 0, input.neverSave ? 1 : 0, ctx.now(), id);
  else ctx.db.run(`INSERT INTO vault_site_rule ("id", "person", "host", "neverFill", "neverSave", "at") VALUES (?, ?, ?, ?, ?, ?)`, id, who, host, input.neverFill ? 1 : 0, input.neverSave ? 1 : 0, ctx.now());
  ctx.emit("vault.site_rule_changed", `entity/${who}`, { personId: who, host, neverFill: input.neverFill, neverSave: input.neverSave }, { vis: "owner" });
  return { host, neverFill: input.neverFill, neverSave: input.neverSave };
}

// ---- export_mine

const PULL_MS: Record<string, number> = { "1h": 60 * 60 * 1000, "1d": DAY, "7d": 7 * DAY };
const REMOVED_KEPT = 30 * DAY;

export async function exportMine(ctx: VaultCtx, input: { expiresIn: string }) {
  ensureG20(ctx);
  if (!(input.expiresIn in PULL_MS)) bad(ctx, "A pull link lasts 1 hour, 1 day or 7 days.");
  // the person themselves, or a turn run for them; the key exists only on a node where they unlocked it, so nobody else's turn gets this far
  const who = ctx.principal.kind === "person" ? ctx.principal.id : ctx.actingFor;
  if (!who || (ctx.principal.kind !== "person" && ctx.actingFor !== who)) return denied(ctx, "Only a person can export their own Mine items.");
  if (!(await currentKeyPort()?.personKey(who))) throw fail("auth.unauthenticated", ctx.trace.traceId, { message: "Your vault key is locked. Sign in again to export your Mine items." });
  if (PULL_MAX.indexOf(input.expiresIn) > PULL_MAX.indexOf(readPolicy(ctx).pullExpiryMax)) refuse(ctx, `This Space limits pull links to ${readPolicy(ctx).pullExpiryMax}.`);
  const mine = rowsOf(ctx.db.all(`SELECT * FROM vault_meta WHERE "owner" = ?`, who)).filter((r) => str(r, "scope") === "mine"
    && (live(r) || ctx.now() - num(r, "deleted_at") <= REMOVED_KEPT));
  if (mine.length === 0) refuse(ctx, "You have no Mine items to export.");
  mine.sort((a, b) => str(a, "name").toLowerCase().localeCompare(str(b, "name").toLowerCase(), "en") || str(a, "id").localeCompare(str(b, "id")));
  const lines: string[] = [], used = new Set<string>();
  for (const r of mine) {
    for (const f of await openFields(ctx, r)) {
      const name = used.has(f.key) ? `${str(r, "handle").replace(/^#/, "")}__${f.key}` : f.key;
      used.add(f.key);
      lines.push(`${name}=${JSON.stringify(f.value)}`);
    }
  }
  const filler = currentFillerOrFail(ctx);
  const id = newId("vex", ctx.now()), token = crypto.randomBytes(24).toString("base64url");
  const sealed = filler.seal(id, [{ key: "env", value: lines.join("\n") + "\n", secret: true }]);
  const expiresAt = ctx.now() + (PULL_MS[input.expiresIn] ?? 0);
  ctx.db.run(
    `INSERT INTO vault_export ("id", "folderId", "by", "createdAt", "expiresAt", "tokenHash", "box", "keyId", "itemCount", "pulledAt", "revokedAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, `vfd_mine${who.replace(/[^a-z0-9]/g, "")}`, who, ctx.now(), expiresAt, crypto.createHash("sha256").update(token).digest("hex"), JSON.stringify(sealed.box), sealed.keyId, mine.length, null, null,
  );
  for (const r of mine) record(ctx, str(r, "id"), "exported", { detail: `own export, pull link ${input.expiresIn}` });
  return { exportId: id, pullUrl: `${(hostOf()?.origin?.() ?? "https://vault.invalid").replace(/\/$/, "")}/exports/${id}?token=${token}`, expiresAt };
}

function currentFillerOrFail(ctx: VaultCtx) {
  const f = currentFiller();
  if (!f) throw fail("internal.unavailable", ctx.trace.traceId, { message: "The vault service is not running, so the export cannot be sealed. Restart it from Console." });
  return f;
}
