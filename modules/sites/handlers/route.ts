// A site is a route (owner, 2 Nov): a name, an address, where it runs, and who may reach it. Vyre does not build or run sites. An agent builds and runs anything on a computer it already has, and Vyre gives it an
// address pointing at a port, or at a folder in Files, which needs no server at all. Site code never runs in vyred, and the Docker socket is never involved.
//   public    /p/<slug>, and any custom domain. Going public is an outward act: sites.promote, Gate act site_promote. A custom domain is public, so only a public site has one, and its route exists only while the site is live.
//   password  not in this version: /p/ strips Authorization and cookies, and Caddy has no password to ask for yet, so it is refused rather than left open.
//   space     /a/<id>: anyone signed in to this Space.
//   private   /a/<id>: the owner, and whoever it is shared with through the same grants as Files and the Vault.
// An artifact is a private site made by a model (sites.artifact_publish), kept in the Artifacts folder so it follows Files rules.
// The older build pipeline (deploy.ts, builders.ts, promote.ts) stays dormant and deferred: nothing here calls it.
// @reads ../migrations/0001_sites_core.sql
// @reads ../migrations/0003_routes.sql

import { VyreErr } from "../../../packages/contracts/src/errors.ts";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import { touchActivity } from "../projections.ts";
import { fail, flag, hexOf, isNull, many, mustSite, nid, num, one, optBool, optInt, optStr, rec, reqStr, str } from "./deploy.ts";

type Row = Record<string, unknown>;
export type Access = "public" | "password" | "space" | "private";
const ACCESS: readonly string[] = ["public", "password", "space", "private"];
const KINDS: readonly string[] = ["site", "app", "api", "worker", "artifact"];
const NAME_MAX = 80;
/** The Space's own gateway and the Caddy admin, and ssh. A site never points at these. */
const RESERVED_PORTS = new Set([22, 2019, 8420]);
const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;
const RESERVED_SLUGS = new Set(["forms", "u", "a", "p", "api", "admin", "assets", "v1"]);
const TICKET_MS = 8 * 60 * 60 * 1000;
const PAGE_DEFAULT = 100;
const PAGE_MAX = 500;
const FILES_MAX = 200;

export interface RouteTarget { computerId?: string; port?: number; folderId?: string }
export interface LocalFile { path: string; base64: string; mime: string }

/** What the host gives this module (host/src/seams/sites-host.ts). Without it nothing is served, and the calls say so. */
export interface SitesHost {
  /** the address people outside reach this Space at, and whether it is a phone address (name.vyre.run) */
  origin(): { origin: string; relay: boolean } | null;
  /** does this target answer now? */
  probe(target: RouteTarget): Promise<{ answering: boolean; detail?: string }>;
  /** the last lines of a site's log on its computer */
  logs?(target: RouteTarget, slug: string, lines: number): Promise<string[]>;
  /** a file or folder on the machine this daemon runs on; null where that machine is a server, whose disk is not the agent's */
  readLocal?(path: string): Promise<LocalFile[] | null>;
  /** Where an artifact's files are kept: the Artifacts folder under Files, written by the server, because publishing must not depend on an agent's own grants in Files. */
  artifacts?: { folder(siteId: string, title: string): Promise<string>; put(folderId: string, name: string, base64: string, mime: string): Promise<void> };
}

let host: SitesHost | null = null;
export function configureRoutes(h: SitesHost | null): void { host = h; }
export const routesHost = (): SitesHost | null => host;

/** Where a custom domain's traffic has to land, and what the machine there can say about it. The host builds this from the machine that runs the site. */
export interface DomainEdge {
  /** the machine's public names: a host name for a CNAME, an address for an apex. Null when it has no public address. */
  public(target: RouteTarget): Promise<{ hostname?: string; ip?: string } | null>;
  /** does the domain point at it? */
  dnsOk(domain: string, to: { hostname?: string; ip?: string }): Promise<boolean>;
  setRoute(target: RouteTarget, domain: string, port: number): Promise<void>;
  removeRoute(target: RouteTarget, domain: string): Promise<void>;
  certIssued(target: RouteTarget, domain: string): Promise<boolean>;
}
let edge: DomainEdge | null = null;
export function configureDomainEdge(e: DomainEdge | null): void { edge = e; }
export const domainEdge = (): DomainEdge | null => edge;

// ---- shapes

export function urlOf(r: Row): string | undefined {
  const o = host?.origin();
  if (!o) return undefined;
  if (str(r.access) === "public") return isNull(r.slug) ? undefined : `${o.origin}/p/${str(r.slug)}`;
  if (str(r.access) === "password") return undefined;
  return `${o.origin}/a/${str(r.id)}`;
}

function siteOut(ctx: Ctx, r: Row): Record<string, unknown> {
  const domain = many(ctx, "SELECT * FROM sites_domain WHERE site_id = ?", r.id).filter((d) => str(d.certificate) === "issued")[0];
  const url = domain ? `https://${str(domain.domain)}` : urlOf(r);
  return {
    siteId: str(r.id), name: str(r.name), kind: str(r.kind), owner: str(r.owner), state: flag(r.live) ? "ready" : "stopped",
    ...(isNull(r.slug) ? {} : { slug: str(r.slug) }), ...(url ? { url } : {}), ...(isNull(r.computer_id) ? {} : { computerId: str(r.computer_id) }), ...(isNull(r.port) ? {} : { port: num(r.port) }),
    ...(isNull(r.target_folder) ? {} : { folderId: str(r.target_folder) }), access: str(r.access) as Access, live: flag(r.live), blocked: flag(r.blocked), updatedAt: num(r.updated_at),
  };
}

export const targetOfRow = (r: Row): RouteTarget => ({ ...(isNull(r.computer_id) ? {} : { computerId: str(r.computer_id) }), ...(isNull(r.port) ? {} : { port: num(r.port) }), ...(isNull(r.target_folder) ? {} : { folderId: str(r.target_folder) }) });

// ---- input

function cleanName(ctx: Ctx, raw: string): string {
  const n = raw.trim();
  if (n.length === 0 || n.length > NAME_MAX || /[\u0000-\u001f\u007f]/.test(n)) fail(ctx, "validation.bad_input", "A name is 1 to 80 characters without control characters.", { field: "name" });
  return n;
}

function slugOf(name: string): string {
  const s = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/g, "");
  return s === "" ? "site" : s;
}

function cleanSlug(ctx: Ctx, raw: string): string {
  const s = raw.trim().toLowerCase();
  if (!SLUG.test(s) || RESERVED_SLUGS.has(s)) fail(ctx, "validation.bad_input", "The address name uses lowercase letters, digits and dashes.", { field: "slug" });
  return s;
}

function freeSlug(ctx: Ctx, wanted: string, own: string | null): string {
  const base = RESERVED_SLUGS.has(wanted) ? `${wanted}-site` : wanted;
  for (let n = 1; n < 200; n++) {
    const s = n === 1 ? base : `${base}-${n}`;
    const taken = one(ctx, "SELECT id FROM sites_site WHERE slug = ? AND deleted_at IS NULL", s);
    if (!taken || taken.id === own) return s;
  }
  return `${base}-${hexOf(own ?? nid(ctx, "sit")).slice(-6)}`;
}

function cleanPort(ctx: Ctx, port: number | undefined): number | undefined {
  if (port === undefined) return undefined;
  if (port < 1 || port > 65535 || RESERVED_PORTS.has(port)) fail(ctx, "validation.bad_input", "That port cannot be served. Use the port your app listens on.", { field: "port" });
  return port;
}

function accessOf(ctx: Ctx, raw: string | undefined, fallback: Access): Access {
  if (raw === undefined) return fallback;
  if (!ACCESS.includes(raw)) fail(ctx, "validation.bad_input", "Access is public, space or private.", { field: "access" });
  // Caddy has no password to ask for yet, and a site must never be open while it says it is not
  if (raw === "password") fail(ctx, "validation.precondition_failed", "A site password is not in this version yet. Use space or private.", { field: "access" });
  return raw as Access;
}

/** Serving reads as the server, so what a site points at is checked against the caller here: nobody puts up a computer or a folder they could not use themselves. */
async function mustComputer(ctx: Ctx, computerId: string | undefined): Promise<void> {
  if (computerId === undefined) return;
  await ctx.call("computers.get", { computerId });
  if (ctx.authorize({ perm: null, level: "use" }, { type: "computer", id: computerId }).effect !== "allow") fail(ctx, "permission.no_grant", "You cannot use that computer.", { computerId });
}

function mustFolder(ctx: Ctx, folderId: string | undefined): void {
  if (folderId === undefined) return;
  if (ctx.authorize({ perm: null, level: "view" }, { type: "folder", id: folderId }).effect !== "allow") fail(ctx, "permission.no_grant", "You cannot read that folder.", { folderId });
}

function needsTarget(ctx: Ctx, r: Row): void {
  if (isNull(r.port) && isNull(r.target_folder)) fail(ctx, "validation.precondition_failed", "Say where it runs first: a port on a computer, or a folder in Files.");
}

// ---- create, read, change

async function sitesCreate(ctx: Ctx, input: unknown): Promise<{ site: unknown }> {
  const o = rec(ctx, input);
  const name = cleanName(ctx, reqStr(ctx, o, "name"));
  const kind = optStr(ctx, o, "kind") ?? "site";
  if (!KINDS.includes(kind)) fail(ctx, "validation.bad_input", "That kind of site is not known.", { field: "kind" });
  const access = accessOf(ctx, optStr(ctx, o, "access"), kind === "artifact" ? "private" : "public");
  const computerId = optStr(ctx, o, "computerId");
  const port = cleanPort(ctx, optInt(ctx, o, "port"));
  await mustComputer(ctx, computerId);
  mustFolder(ctx, optStr(ctx, o, "folderId"));
  const rawSlug = optStr(ctx, o, "slug");
  const slug = kind === "artifact" ? null : freeSlug(ctx, rawSlug === undefined ? slugOf(name) : cleanSlug(ctx, rawSlug), null);
  const id = nid(ctx, "sit");
  const now = ctx.now();
  ctx.db.run(
    "INSERT INTO sites_site (id, name, kind, owner, repo_url, repo_folder_id, template_kit, state, settings, staging_secret, service_principal, created_at, updated_at, deleted_at, slug, computer_id, port, target_folder, access, live, blocked) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    id, name, kind, ctx.actingFor ?? ctx.principal.id, optStr(ctx, o, "repoUrl") ?? null, null, optStr(ctx, o, "templateKit") ?? null, "stopped", "{}", null, `svc_site_${hexOf(id)}`, now, now, null, slug, computerId ?? null, port ?? null, optStr(ctx, o, "folderId") ?? null, access, 0, 0,
  );
  touchActivity(ctx.db, id, "site.created", now);
  ctx.emit("site.created", `site/${id}`, { siteId: id, name, ...(access === "private" ? { private: true } : {}) });
  return { site: siteOut(ctx, mustSite(ctx, id)) };
}

async function sitesGet(ctx: Ctx, input: unknown): Promise<{ site: unknown }> {
  return { site: siteOut(ctx, mustSite(ctx, reqStr(ctx, rec(ctx, input), "siteId"))) };
}

async function sitesList(ctx: Ctx, input: unknown): Promise<{ sites: unknown[]; next?: string; total: number }> {
  const o = rec(ctx, input);
  const limit = Math.min(optInt(ctx, o, "limit") ?? PAGE_DEFAULT, PAGE_MAX);
  const cursor = optStr(ctx, o, "cursor");
  const offset = cursor !== undefined && /^[0-9]{1,9}$/.test(cursor) ? Number(cursor) : 0;
  const kind = optStr(ctx, o, "kind");
  const section = optStr(ctx, o, "section");
  const me = ctx.actingFor ?? ctx.principal.id;
  let rows = many(ctx, "SELECT * FROM sites_site WHERE deleted_at IS NULL");
  if (kind === "artifact") rows = rows.filter((r) => r.kind === "artifact");
  else if (kind === "site") rows = rows.filter((r) => r.kind !== "artifact");
  if (section === "personal") rows = rows.filter((r) => r.owner === me);
  if (section === "shared") rows = rows.filter((r) => r.owner !== me);
  rows = rows.filter((r) => ctx.authorize({ perm: null, level: "view" }, { type: "site", id: str(r.id) }).effect === "allow");
  rows.sort((a, b) => num(b.updated_at) - num(a.updated_at) || str(a.id).localeCompare(str(b.id)));
  const out: { sites: unknown[]; next?: string; total: number } = { sites: rows.slice(offset, offset + limit).map((r) => siteOut(ctx, r)), total: rows.length };
  if (offset + limit < rows.length) out.next = String(offset + limit);
  return out;
}

async function sitesUpdate(ctx: Ctx, input: unknown): Promise<{ site: unknown }> {
  const o = rec(ctx, input);
  const site = mustSite(ctx, reqStr(ctx, o, "siteId"));
  const name = optStr(ctx, o, "name");
  const access = accessOf(ctx, optStr(ctx, o, "access"), str(site.access) as Access);
  const port = cleanPort(ctx, optInt(ctx, o, "port"));
  const computerId = optStr(ctx, o, "computerId");
  await mustComputer(ctx, computerId);
  const folderId = optStr(ctx, o, "folderId");
  mustFolder(ctx, folderId);
  // becoming public is an outward act: it comes down here and goes back up through sites.promote and the Gate
  const live = flag(site.live) && !(access === "public" && site.access !== "public");
  // and a site that stops being public takes its custom domains down with it
  if (site.access === "public" && access !== "public") await routeDomains(ctx, site, false);
  ctx.db.run(
    "UPDATE sites_site SET name = ?, access = ?, port = ?, computer_id = ?, target_folder = ?, live = ?, updated_at = ? WHERE id = ?",
    name === undefined ? site.name : cleanName(ctx, name), access, port ?? site.port ?? null, computerId ?? site.computer_id ?? null, folderId ?? site.target_folder ?? null, live ? 1 : 0, ctx.now(), site.id,
  );
  return { site: siteOut(ctx, mustSite(ctx, str(site.id))) };
}

async function sitesDelete(ctx: Ctx, input: unknown): Promise<{ deleted: boolean }> {
  const site = mustSite(ctx, reqStr(ctx, rec(ctx, input), "siteId"));
  const now = ctx.now();
  await routeDomains(ctx, site, false);
  ctx.db.run("DELETE FROM sites_domain WHERE site_id = ?", site.id);
  ctx.db.run("DELETE FROM sites_ticket WHERE site_id = ?", site.id);
  ctx.db.run("UPDATE sites_site SET state = ?, live = ?, slug = ?, deleted_at = ?, updated_at = ? WHERE id = ?", "stopped", 0, null, now, now, site.id);
  return { deleted: true };
}

// ---- going live

function goLive(ctx: Ctx, site: Row): { site: unknown } {
  const id = str(site.id);
  needsTarget(ctx, site);
  if (flag(site.blocked)) fail(ctx, "validation.precondition_failed", "This site was taken down by an admin of this server.");
  const now = ctx.now();
  ctx.db.run("UPDATE sites_site SET live = ?, state = ?, updated_at = ? WHERE id = ?", 1, "ready", now, id);
  touchActivity(ctx.db, id, "site.published", now);
  const fresh = mustSite(ctx, id);
  const url = urlOf(fresh);
  ctx.emit("site.published", `site/${id}`, { siteId: id, ...(url ? { url } : {}), access: str(fresh.access) as Access });
  return { site: siteOut(ctx, fresh) };
}

/** A site's custom domains follow it: up when it goes live, down when it stops or stops being public. The record stays, so publishing again brings them back. */
async function routeDomains(ctx: Ctx, site: Row, up: boolean): Promise<void> {
  if (!edge) return;
  const target = targetOfRow(site);
  for (const d of many(ctx, "SELECT * FROM sites_domain WHERE site_id = ?", site.id)) {
    try {
      if (up && target.port !== undefined) await edge.setRoute(target, str(d.domain), target.port);
      else await edge.removeRoute(target, str(d.domain));
    } catch (e) { ctx.log.warn("sites: a domain route did not change", { domain: str(d.domain), error: e instanceof Error ? e.message : String(e) }); }
  }
}

/** A computer that serves a site stays awake. One the caller cannot configure keeps its idle time, and the skill says so. */
async function keepAwake(ctx: Ctx, site: Row): Promise<void> {
  if (isNull(site.computer_id)) return;
  try { await ctx.call("computers.configure", { computerId: str(site.computer_id), idleSleepMinutes: 0 }); } catch (e) {
    ctx.log.warn("sites: the computer keeps its idle sleep", { error: e instanceof Error ? e.message : String(e) });
  }
}

async function sitesPromote(ctx: Ctx, input: unknown): Promise<{ site: unknown }> {
  const site = mustSite(ctx, reqStr(ctx, rec(ctx, input), "siteId"));
  if (site.access !== "public") fail(ctx, "validation.precondition_failed", "This site is not public. Change its access to public first, or use sites_publish.");
  await keepAwake(ctx, site);
  const out = goLive(ctx, site);
  await routeDomains(ctx, site, true);
  return out;
}

async function sitesPublish(ctx: Ctx, input: unknown): Promise<{ site: unknown }> {
  const site = mustSite(ctx, reqStr(ctx, rec(ctx, input), "siteId"));
  if (site.access === "public") fail(ctx, "validation.precondition_failed", "Going public is held for approval: use sites_promote.");
  await keepAwake(ctx, site);
  return goLive(ctx, site);
}

async function sitesStop(ctx: Ctx, input: unknown): Promise<{ site: unknown }> {
  const site = mustSite(ctx, reqStr(ctx, rec(ctx, input), "siteId"));
  const id = str(site.id);
  const now = ctx.now();
  ctx.db.run("UPDATE sites_site SET live = ?, state = ?, updated_at = ? WHERE id = ?", 0, "stopped", now, id);
  await routeDomains(ctx, site, false);
  touchActivity(ctx.db, id, "site.stopped", now);
  ctx.emit("site.stopped", `site/${id}`, { siteId: id });
  return { site: siteOut(ctx, mustSite(ctx, id)) };
}

async function sitesStatus(ctx: Ctx, input: unknown): Promise<{ answering: boolean; detail?: string; url?: string; live: boolean; blocked: boolean }> {
  const site = mustSite(ctx, reqStr(ctx, rec(ctx, input), "siteId"));
  const url = urlOf(site);
  const base = { live: flag(site.live), blocked: flag(site.blocked), ...(url ? { url } : {}) };
  if (!isNull(site.target_folder)) return { ...base, answering: true };
  if (isNull(site.port)) return { ...base, answering: false, detail: "It has no port yet." };
  if (!host) return { ...base, answering: false, detail: "This server cannot reach computers yet." };
  const p = await host.probe(targetOfRow(site));
  return { ...base, answering: p.answering, ...(p.detail ? { detail: p.detail } : {}) };
}

async function sitesHost(ctx: Ctx): Promise<{ origin?: string; relay: boolean; computers: boolean; domains: boolean; domainsNeed?: string }> {
  const o = host?.origin() ?? null;
  let computers = false;
  try { computers = ((await ctx.call("computers.hosts", {})) as { available?: boolean }).available === true; } catch { /* no computers module: none */ }
  const domains = computers;
  return { ...(o ? { origin: o.origin } : {}), relay: o?.relay === true, computers, domains, ...(domains ? {} : { domainsNeed: "A custom domain needs a server with a public address." }) };
}

async function sitesLogs(ctx: Ctx, input: unknown): Promise<{ lines: string[] }> {
  const o = rec(ctx, input);
  const site = mustSite(ctx, reqStr(ctx, o, "siteId"));
  const tail = optInt(ctx, o, "tail") ?? 200;
  if (tail < 1 || tail > 1000) fail(ctx, "validation.bad_input", "Tail is between 1 and 1000 lines.", { field: "tail" });
  if (!host?.logs || isNull(site.computer_id)) return { lines: [] };
  try { return { lines: await host.logs(targetOfRow(site), str(site.slug) || hexOf(str(site.id)), tail) }; } catch (e) {
    ctx.log.warn("sites: logs unavailable", { error: e instanceof Error ? e.message : String(e) });
    return { lines: [] };
  }
}

// ---- artifacts

async function artifactPublish(ctx: Ctx, input: unknown): Promise<{ artifactId: string; url?: string; updated: boolean }> {
  const o = rec(ctx, input);
  const title = cleanName(ctx, reqStr(ctx, o, "title"));
  const html = optStr(ctx, o, "html");
  const fileId = optStr(ctx, o, "fileId");
  const folderIn = optStr(ctx, o, "folderId");
  const localPath = optStr(ctx, o, "path");
  const port = cleanPort(ctx, optInt(ctx, o, "port"));
  let computerId = optStr(ctx, o, "computerId");
  if ([html, fileId, folderIn, localPath, port].filter((v) => v !== undefined).length !== 1) fail(ctx, "validation.bad_input", "Give one of html, fileId, folderId, path or port.", { field: "html" });
  // a port with no computer named is on the agent's own computer, when it has one
  if (port !== undefined && computerId === undefined && ctx.principal.kind === "agent") {
    try { computerId = ((await ctx.call("computers.list", {})) as { computers?: { computerId?: string; agentId?: string }[] }).computers?.find((c) => c.agentId === ctx.principal.id)?.computerId; } catch { /* no computers here: the port is on this machine */ }
  }
  await mustComputer(ctx, computerId);
  mustFolder(ctx, folderIn);
  const me = ctx.actingFor ?? ctx.principal.id;
  const wanted = optStr(ctx, o, "artifactId");
  let row: Row | undefined = wanted !== undefined ? mustSite(ctx, wanted)
    : many(ctx, "SELECT * FROM sites_site WHERE kind = ? AND owner = ? AND deleted_at IS NULL", "artifact", me).find((r) => r.name === title);
  if (row && row.kind !== "artifact") fail(ctx, "validation.bad_input", "That is a site, not an artifact.", { field: "artifactId" });
  if (row && row.owner !== me && ctx.authorize({ perm: null, level: "edit" }, { type: "site", id: str(row.id) }).effect !== "allow") fail(ctx, "permission.no_grant", "You can see that artifact but cannot change it.");
  const updated = row !== undefined;
  const id = row ? str(row.id) : nid(ctx, "sit");
  const now = ctx.now();
  if (!row) {
    ctx.db.run(
      "INSERT INTO sites_site (id, name, kind, owner, repo_url, repo_folder_id, template_kit, state, settings, staging_secret, service_principal, created_at, updated_at, deleted_at, slug, computer_id, port, target_folder, access, live, blocked) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      id, title, "artifact", me, null, null, null, "stopped", "{}", null, `svc_site_${hexOf(id)}`, now, now, null, null, null, null, null, "private", 0, 0,
    );
    ctx.emit("site.created", `site/${id}`, { siteId: id, name: title, private: true });
    row = mustSite(ctx, id);
  }
  let folderId: string | null = folderIn ?? null;
  if (html !== undefined || fileId !== undefined || localPath !== undefined) {
    const store = host?.artifacts;
    if (!store) fail(ctx, "validation.precondition_failed", "This server cannot keep artifacts yet.");
    folderId = isNull(row.target_folder) ? await store.folder(id, title) : str(row.target_folder);
    const put = (name: string, base64: string, mime: string): Promise<void> => store.put(folderId as string, name, base64, mime);
    if (html !== undefined) await put("index.html", Buffer.from(html, "utf8").toString("base64"), "text/html");
    else if (fileId !== undefined) {
      const f = (await ctx.call("files.read", { fileId, as: "base64" })) as { base64?: string; mime?: string };
      if (typeof f.base64 !== "string") fail(ctx, "validation.precondition_failed", "That file could not be read.");
      await put("index.html", f.base64, f.mime ?? "text/html");
    } else {
      const got = host?.readLocal ? await host.readLocal(localPath as string) : null;
      if (got === null) fail(ctx, "validation.precondition_failed", "That path is not on this machine. Pass html, or save it to Files and pass fileId or folderId.", { field: "path" });
      if (got.length === 0 || got.length > FILES_MAX) fail(ctx, "validation.too_large", "A published folder holds 1 to 200 files.", { field: "path" });
      if (got.length === 1) await put("index.html", (got[0] as LocalFile).base64, (got[0] as LocalFile).mime);
      else for (const f of got) await put(f.path.replaceAll("/", "__"), f.base64, f.mime);
    }
  }
  ctx.db.run(
    "UPDATE sites_site SET port = ?, computer_id = ?, target_folder = ?, live = ?, state = ?, updated_at = ? WHERE id = ?",
    port ?? null, port === undefined ? null : (computerId ?? null), port === undefined ? folderId : null, 1, "ready", now, id,
  );
  touchActivity(ctx.db, id, "site.published", now);
  const fresh = mustSite(ctx, id);
  const url = urlOf(fresh);
  ctx.emit("site.published", `site/${id}`, { siteId: id, ...(url ? { url } : {}), access: "private" });
  await announce(ctx, id, title);
  return { artifactId: id, ...(url ? { url } : {}), updated };
}

/** A card in the chat the work was asked in. Nothing to say it in is not a failure of the publish. */
async function announce(ctx: Ctx, id: string, title: string): Promise<void> {
  if (!ctx.thread) return;
  try {
    await ctx.call("chat.post", { threadId: ctx.thread, body: "", mentions: [], blocks: [{ type: "artifact", v: 1, data: { artifactId: id, title } }], idempotencyKey: `artifact:${id}:${ctx.now()}` });
  } catch (e) {
    if (!(e instanceof VyreErr)) throw e;
    ctx.log.warn("sites: the artifact card was not posted", { code: e.error.code });
  }
}

const hashHex = async (text: string): Promise<string> => Array.from(new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))), (b) => b.toString(16).padStart(2, "0")).join("");

async function artifactOpen(ctx: Ctx, input: unknown): Promise<{ path: string; url?: string; expiresAt: number }> {
  const id = reqStr(ctx, rec(ctx, input), "artifactId");
  const site = mustSite(ctx, id);
  if (!flag(site.live)) fail(ctx, "validation.precondition_failed", "It is stopped. Publish it again to open it.");
  // only a person signed in opens one: an agent shows the person the card, and the person's own session opens it
  if (ctx.principal.kind !== "person") fail(ctx, "permission.no_grant", "Only a person can open an artifact. Give them the link.");
  const now = ctx.now();
  ctx.db.run("DELETE FROM sites_ticket WHERE expires_at < ?", now);
  const token = Array.from(globalThis.crypto.getRandomValues(new Uint8Array(24)), (b) => b.toString(16).padStart(2, "0")).join("");
  const expiresAt = now + TICKET_MS;
  ctx.db.run("INSERT INTO sites_ticket (token_hash, site_id, principal, expires_at) VALUES (?, ?, ?, ?)", await hashHex(token), id, ctx.principal.id, expiresAt);
  const path = `/a/${id}/k/${token}/`;
  const o = host?.origin();
  return { path, ...(o ? { url: `${o.origin}${path}` } : {}), expiresAt };
}

// ---- what the gateway asks

export interface ServedRoute { siteId: string; slug: string; access: Access; live: boolean; blocked: boolean; target: RouteTarget }
const served = (r: Row): ServedRoute => ({ siteId: str(r.id), slug: str(r.slug), access: str(r.access) as Access, live: flag(r.live), blocked: flag(r.blocked), target: targetOfRow(r) });

/** The route behind /p/<slug>. Host call, not a capability: a visitor has no session. */
export function routeBySlug(ctx: Pick<Ctx, "db">, slug: string): ServedRoute | null {
  const r = (ctx.db.all("SELECT * FROM sites_site WHERE slug = ? AND deleted_at IS NULL", slug) as Row[])[0];
  return r ? served(r) : null;
}

/** The route behind a custom domain, for the host's Caddy reconcile. */
export function routeById(ctx: Pick<Ctx, "db">, siteId: string): ServedRoute | null {
  const r = (ctx.db.all("SELECT * FROM sites_site WHERE id = ? AND deleted_at IS NULL", siteId) as Row[])[0];
  return r ? served(r) : null;
}

/** The route and who is asking, for /a/<id>/k/<token>/. The caller checks access for that person on every request, so a revoked share ends at once. Null for a token that is not good for this artifact now. */
export async function routeByTicket(ctx: Pick<Ctx, "db">, siteId: string, token: string, now: number): Promise<{ route: ServedRoute; principal: string; owner: string } | null> {
  if (!/^[0-9a-f]{48}$/.test(token)) return null;
  const t = (ctx.db.all("SELECT * FROM sites_ticket WHERE token_hash = ?", await hashHex(token)) as Row[])[0];
  if (!t || t.site_id !== siteId || num(t.expires_at) <= now) return null;
  const r = (ctx.db.all("SELECT * FROM sites_site WHERE id = ? AND deleted_at IS NULL", siteId) as Row[])[0];
  return r ? { route: served(r), principal: str(t.principal), owner: str(r.owner) } : null;
}

export const routeHandlers = {
  "sites.create": (ctx: Ctx, input: unknown) => sitesCreate(ctx, input),
  "sites.get": (ctx: Ctx, input: unknown) => sitesGet(ctx, input),
  "sites.list": (ctx: Ctx, input: unknown) => sitesList(ctx, input),
  "sites.update": (ctx: Ctx, input: unknown) => sitesUpdate(ctx, input),
  "sites.delete": (ctx: Ctx, input: unknown) => sitesDelete(ctx, input),
  "sites.promote": (ctx: Ctx, input: unknown) => sitesPromote(ctx, input),
  "sites.publish": (ctx: Ctx, input: unknown) => sitesPublish(ctx, input),
  "sites.stop": (ctx: Ctx, input: unknown) => sitesStop(ctx, input),
  "sites.status": (ctx: Ctx, input: unknown) => sitesStatus(ctx, input),
  "sites.host": (ctx: Ctx) => sitesHost(ctx),
  "sites.logs": (ctx: Ctx, input: unknown) => sitesLogs(ctx, input),
  "sites.artifact_publish": (ctx: Ctx, input: unknown) => artifactPublish(ctx, input),
  "sites.artifact_open": (ctx: Ctx, input: unknown) => artifactOpen(ctx, input),
};
