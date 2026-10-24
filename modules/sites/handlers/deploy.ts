// sites core: create, build, deploy to staging, previews, env names, staging password, service identity, logs (spec 2.20, 3.6; ARCH 7.6).
// Each site is a Docker container on the vyre-sites network; Caddy routes staging-<id>.<space-domain> and the production domain to it.
// Docker and Caddy sit behind the SiteRuntime / SiteRouter / SiteDns drivers (the build driver is P-L8_03, the Caddy admin client is in the host).
// Staging and previews are never routed without a sealed Vault password: the route is refused before it reaches the router.
// Promote, rollback and site tables are P-L8_02. Values of environment variables never pass through this file, only Vault handles.
// Build plan notes follow the 0.6 publish builder (core/publish/builder-plan.js): the build runs in a network with no route to the Space data.
// @reads ../migrations/0001_sites_core.sql

import { ERROR_CODES, VyreErr } from "../../../packages/contracts/src/errors.ts";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import type { ErrorCode, Level, NextStep, VyreError } from "../../../packages/contracts/src/types.ts";
import { mintUuid } from "../../../lib/ids.ts";
import { touchActivity } from "../projections.ts";

export const NETWORK = "vyre-sites";
export const DEFAULT_BRANCH = "main";
const PAGE_DEFAULT = 100;
const PAGE_MAX = 500;
const LOG_LINES = 500;
const LOG_LINE_CHARS = 500;
const SETTINGS_MAX = 16 * 1024;
const NAME_MAX = 80;
const BRANCH_MAX = 100;

export type SiteKind = "site" | "app" | "api" | "worker" | "artifact";
export type SiteState = "queued" | "building" | "ready" | "failed" | "stopped";
export type DeployEnv = "staging" | "preview" | "production";
export type CertState = "pending" | "issued" | "failed";

const KINDS: readonly string[] = ["site", "app", "api", "worker", "artifact"];

// ---- drivers ------------------------------------------------------------------------------------------------

export interface BuildRequest {
  siteId: string;
  deploymentId: string;
  kind: SiteKind;
  repoUrl: string | null;
  folderId: string | null;
  branch: string;
}

export interface BuildResult {
  ok: boolean;
  image?: string;
  commit?: string;
  /** set when the build came from a pull request, so a merge can remove its preview */
  pullRequest?: number;
  log: string[];
}

export interface StartRequest {
  siteId: string;
  deploymentId: string;
  env: DeployEnv;
  image: string;
  network: string;
  /** container name on the network; the upstream is `<name>:<port>` */
  name: string;
  /** one reference per environment name; the value was filled from the Vault into this ref, never read here */
  envRefs: { name: string; ref: string }[];
  servicePrincipal: string;
}

export interface StartResult {
  containerId: string;
  upstream: string;
}

export interface SiteRuntime {
  build(req: BuildRequest): Promise<BuildResult>;
  start(req: StartRequest): Promise<StartResult>;
  stop(containerId: string): Promise<void>;
  logs(containerId: string, tail: number): Promise<string[]>;
}

export interface RouteSpec {
  host: string;
  upstream: string;
  /** staging and previews carry the Vault handle of the sealed password; production carries none */
  auth: { handle: string } | null;
}

export interface SiteRouter {
  setRoute(spec: RouteSpec): Promise<void>;
  removeRoute(host: string): Promise<void>;
  certState(host: string): Promise<CertState>;
}

export interface SiteDns {
  /** true when the domain points at the target (the Space edge address) */
  check(domain: string, target: string): Promise<boolean>;
}

export interface SiteDrivers {
  runtime: SiteRuntime;
  router: SiteRouter;
  dns: SiteDns;
  /** the Space's own domain; staging and preview hosts are subdomains of it */
  spaceDomain: string;
}

let configured: SiteDrivers | null = null;

/** The host calls this once at start with the Docker, Caddy and DNS drivers. Tests pass fakes; null clears. */
export function configureSites(drivers: SiteDrivers | null): void {
  configured = drivers;
}

// ---- errors and input helpers -------------------------------------------------------------------------------

type Row = Record<string, unknown>;

const NEXT: Record<NextStep["kind"], string> = {
  retry: "Try again",
  switch_model: "Switch model",
  use_backup_key: "Use the backup key",
  ask_access: "Ask for access",
  open_settings: "Open settings",
  reconnect: "Reconnect",
  edit_input: "Fix the input",
  wait: "Wait a moment",
  contact_admin: "Contact an admin",
  report: "Report a problem",
};

export function fail(ctx: Ctx, code: ErrorCode, message?: string, details?: Record<string, unknown>): never {
  const def = ERROR_CODES.find((e) => e.code === code) ?? ERROR_CODES.find((e) => e.code === "internal.unexpected");
  if (!def) throw new Error("error catalogue is empty");
  const error: VyreError = {
    code: def.code,
    message: message ?? def.what,
    retryable: def.retryable,
    traceId: ctx.trace.traceId,
    next: def.next.map((kind) => ({ kind, label: NEXT[kind] })),
  };
  if (details) error.details = details;
  throw new VyreErr(error);
}

export function num(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v !== "" && Number.isFinite(Number(v))) return Number(v);
  return 0;
}

export function isNull(v: unknown): boolean {
  return v === null || v === undefined;
}

export function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export function flag(v: unknown): boolean {
  return v === true || v === 1 || v === "1";
}

export function one(ctx: Ctx, sql: string, ...args: unknown[]): Row | undefined {
  return (ctx.db.all(sql, ...args) as Row[])[0];
}

export function many(ctx: Ctx, sql: string, ...args: unknown[]): Row[] {
  return ctx.db.all(sql, ...args) as Row[];
}

export function rec(ctx: Ctx, input: unknown): Record<string, unknown> {
  if (input === undefined || input === null) return {};
  if (typeof input !== "object" || Array.isArray(input)) fail(ctx, "validation.bad_input", "The input is not valid.");
  return input as Record<string, unknown>;
}

export function optStr(ctx: Ctx, o: Record<string, unknown>, key: string): string | undefined {
  const v = o[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") fail(ctx, "validation.bad_input", "The input is not valid.", { field: key });
  return v;
}

export function reqStr(ctx: Ctx, o: Record<string, unknown>, key: string): string {
  const v = optStr(ctx, o, key);
  if (v === undefined || v.length === 0) fail(ctx, "validation.bad_input", "The input is not valid.", { field: key });
  return v;
}

export function optBool(ctx: Ctx, o: Record<string, unknown>, key: string): boolean | undefined {
  const v = o[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "boolean") fail(ctx, "validation.bad_input", "The input is not valid.", { field: key });
  return v;
}

export function optInt(ctx: Ctx, o: Record<string, unknown>, key: string): number | undefined {
  const v = o[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "number" || !Number.isInteger(v)) fail(ctx, "validation.bad_input", "The input is not valid.", { field: key });
  return v;
}

export function nid(ctx: Ctx, prefix: string): string {
  return `${prefix}_${mintUuid(ctx.now()).replaceAll("-", "")}`;
}

/** The hostname-safe part of a site id: `sit_ab12...` becomes `ab12...`. */
export function hexOf(siteId: string): string {
  return siteId.replace(/^[a-z]+_/, "");
}

function cleanName(ctx: Ctx, name: string): string {
  const n = name.trim();
  if (n.length === 0 || n.length > NAME_MAX || /[\u0000-\u001f\u007f]/.test(n)) {
    fail(ctx, "validation.bad_input", "A site name is 1 to 80 characters without control characters.", { field: "name" });
  }
  return n;
}

function cleanRepoUrl(ctx: Ctx, url: string): string {
  const u = url.trim();
  if (u.length === 0 || u.length > 500 || /\s/.test(u) || !/^(https:\/\/|ssh:\/\/|git@)/.test(u)) {
    fail(ctx, "validation.bad_input", "The repo address must start with https://, ssh:// or git@.", { field: "repoUrl" });
  }
  return u;
}

export function cleanBranch(ctx: Ctx, branch: string): string {
  const b = branch.trim();
  if (b.length === 0 || b.length > BRANCH_MAX || !/^[A-Za-z0-9._/-]+$/.test(b) || b.includes("..") || b.startsWith("/") || b.endsWith("/")) {
    fail(ctx, "validation.bad_input", "That branch name cannot be used.", { field: "branch" });
  }
  return b;
}

function fnv(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0").slice(0, 4);
}

/** A hostname label for a branch: lowercase, dashes, at most 24 characters plus a 4 hex tag so `a/b` and `a-b` never collide. */
export function branchSlug(branch: string): string {
  const base = branch.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24).replace(/-+$/g, "");
  return `${base || "branch"}-${fnv(branch)}`;
}

export function stagingHost(siteId: string, spaceDomain: string): string {
  return `staging-${hexOf(siteId)}.${spaceDomain}`;
}

export function previewHost(siteId: string, branch: string, spaceDomain: string): string {
  return `preview-${hexOf(siteId).slice(0, 12)}-${branchSlug(branch)}.${spaceDomain}`;
}

export function siteDrivers(ctx: Ctx): SiteDrivers {
  if (!configured) fail(ctx, "validation.precondition_failed", "Sites are not connected on this server yet. Docker and Caddy are needed.");
  return configured;
}

function parseJson(text: unknown): Record<string, unknown> {
  if (typeof text !== "string" || text === "") return {};
  try {
    const v: unknown = JSON.parse(text);
    return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function parseLines(text: unknown): string[] {
  if (typeof text !== "string" || text === "") return [];
  try {
    const v: unknown = JSON.parse(text);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function clipLines(lines: string[]): string[] {
  return lines.slice(-LOG_LINES).map((l) => (l.length > LOG_LINE_CHARS ? l.slice(0, LOG_LINE_CHARS) : l));
}

// ---- output shapes ------------------------------------------------------------------------------------------

interface SiteOut {
  siteId: string;
  name: string;
  kind: SiteKind;
  owner: string;
  repoFolderId?: string;
  stagingUrl?: string;
  productionUrl?: string;
  state: SiteState;
}

interface DeploymentOut {
  deploymentId: string;
  siteId: string;
  env: DeployEnv;
  state: SiteState;
  url?: string;
  branch?: string;
  commit?: string;
  at: number;
}

function depOut(r: Row): DeploymentOut {
  const out: DeploymentOut = {
    deploymentId: str(r.id),
    siteId: str(r.site_id),
    env: str(r.env) as DeployEnv,
    state: str(r.state) as SiteState,
    at: num(r.at),
  };
  if (!isNull(r.url)) out.url = str(r.url);
  if (!isNull(r.branch)) out.branch = str(r.branch);
  if (!isNull(r.commit_sha)) out.commit = str(r.commit_sha);
  return out;
}

function newest(rows: Row[]): Row | undefined {
  let best: Row | undefined;
  for (const r of rows) if (!best || num(r.at) > num(best.at) || (num(r.at) === num(best.at) && str(r.id) > str(best.id))) best = r;
  return best;
}

function siteOut(ctx: Ctx, r: Row): SiteOut {
  const deps = many(ctx, "SELECT * FROM sites_deployment WHERE site_id = ? AND removed_at IS NULL", r.id);
  const live = (env: string): Row | undefined => newest(deps.filter((d) => d.env === env && !isNull(d.url)));
  const out: SiteOut = { siteId: str(r.id), name: str(r.name), kind: str(r.kind) as SiteKind, owner: str(r.owner), state: str(r.state) as SiteState };
  if (!isNull(r.repo_folder_id)) out.repoFolderId = str(r.repo_folder_id);
  const staging = live("staging");
  if (staging) out.stagingUrl = str(staging.url);
  const prod = live("production");
  if (prod) out.productionUrl = str(prod.url);
  return out;
}

export function mustSite(ctx: Ctx, siteId: string): Row {
  const row = one(ctx, "SELECT * FROM sites_site WHERE id = ? AND deleted_at IS NULL", siteId);
  if (!row) fail(ctx, "validation.not_found", "That site does not exist.");
  return row;
}

function mustDeployment(ctx: Ctx, siteId: string, deploymentId: string): Row {
  const row = one(ctx, "SELECT * FROM sites_deployment WHERE id = ? AND site_id = ?", deploymentId, siteId);
  if (!row) fail(ctx, "validation.not_found", "That deployment does not exist.");
  return row;
}

function setSiteState(ctx: Ctx, siteId: string, state: SiteState): void {
  ctx.db.run("UPDATE sites_site SET state = ?, updated_at = ? WHERE id = ?", state, ctx.now(), siteId);
}

function noteActivity(ctx: Ctx, siteId: string, event: string): void {
  touchActivity(ctx.db, siteId, event, ctx.now());
}

function siteSettings(r: Row): Record<string, unknown> {
  return parseJson(r.settings);
}

export function defaultBranchOf(r: Row): string {
  const v = siteSettings(r).defaultBranch;
  return typeof v === "string" && v.length > 0 ? v : DEFAULT_BRANCH;
}

function pageOf(ctx: Ctx, o: Record<string, unknown>): { offset: number; limit: number } {
  const limit = Math.min(optInt(ctx, o, "limit") ?? PAGE_DEFAULT, PAGE_MAX);
  const cursor = optStr(ctx, o, "cursor");
  let offset = 0;
  if (cursor !== undefined) {
    if (!/^[0-9]{1,9}$/.test(cursor)) fail(ctx, "validation.bad_input", "The cursor is not valid.", { field: "cursor" });
    offset = Number(cursor);
  }
  if (limit < 1) fail(ctx, "validation.bad_input", "The limit must be at least 1.", { field: "limit" });
  return { offset, limit };
}

function vaultUse(ctx: Ctx, handle: string): void {
  try {
    ctx.vault.use(handle);
  } catch (e) {
    if (e instanceof VyreErr) throw e;
    fail(ctx, "permission.no_grant", "This site's owner has no grant on that Vault key.", { handle });
  }
}

// ---- routes -------------------------------------------------------------------------------------------------

function saveRoute(ctx: Ctx, host: string, siteId: string, deploymentId: string, env: DeployEnv, authHandle: string | null): void {
  ctx.db.run("DELETE FROM sites_route WHERE host = ?", host);
  ctx.db.run(
    "INSERT INTO sites_route (host, site_id, deployment_id, env, auth_handle, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    host, siteId, deploymentId, env, authHandle, ctx.now(),
  );
}

/**
 * Put a deployment behind Caddy. Staging and previews are only routed with a sealed Vault password:
 * the handle is checked with vault.use and filled into the route before the router sees the route.
 */
export async function routeDeployment(ctx: Ctx, d: SiteDrivers, site: Row, dep: Row): Promise<void> {
  const env = str(dep.env) as DeployEnv;
  const host = str(dep.host);
  const upstream = str(dep.upstream);
  if (!host || !upstream) fail(ctx, "internal.unexpected", "The deployment has no address to route.");
  let auth: { handle: string } | null = null;
  if (env !== "production") {
    const handle = isNull(site.staging_secret) ? "" : str(site.staging_secret);
    if (!handle) fail(ctx, "validation.precondition_failed", "Staging is always behind a password. Choose a staging password first.");
    vaultUse(ctx, handle);
    await ctx.vault.fill(handle, { kind: "route_auth", ref: host });
    auth = { handle };
  }
  await d.router.setRoute({ host, upstream, auth });
  saveRoute(ctx, host, str(site.id), str(dep.id), env, auth ? auth.handle : null);
}

async function dropRoute(ctx: Ctx, d: SiteDrivers, host: string): Promise<void> {
  if (!host) return;
  try {
    await d.router.removeRoute(host);
  } catch (e) {
    ctx.log.warn("sites: route removal failed", { host, error: e instanceof Error ? e.message : String(e) });
  }
  ctx.db.run("DELETE FROM sites_route WHERE host = ?", host);
}

async function stopContainer(ctx: Ctx, d: SiteDrivers, containerId: string): Promise<void> {
  if (!containerId) return;
  try {
    await d.runtime.stop(containerId);
  } catch (e) {
    ctx.log.warn("sites: container stop failed", { containerId, error: e instanceof Error ? e.message : String(e) });
  }
}

// ---- service identity ---------------------------------------------------------------------------------------

const LEVELS: Level[] = ["edit", "use", "view"];

/** The highest of edit, use, view the creating owner holds on the resource; a service never gets more than its owner. */
function cappedLevel(ctx: Ctx, type: string, id: string): Level | null {
  for (const level of LEVELS) {
    const d = ctx.authorize({ perm: null, level }, { type, id });
    if (d.effect === "allow") return level;
  }
  return null;
}

// ---- create, get, list, update, delete ----------------------------------------------------------------------

async function deploymentsFolder(ctx: Ctx, name: string, hex: string): Promise<string> {
  const tree = (await ctx.call("files.tree", {})) as { roots?: { key?: string; folderId?: string }[] };
  const root = (tree.roots ?? []).find((r) => r.key === "deployments");
  if (!root || typeof root.folderId !== "string") fail(ctx, "validation.precondition_failed", "The Deployments folder is not available.");
  const attempt = async (folderName: string): Promise<string> => {
    const out = (await ctx.call("files.folder.create", { parentId: root.folderId, name: folderName, idempotencyKey: `site-folder-${hex}-${folderName.length}` })) as { folder?: { folderId?: string } };
    const folderId = out.folder?.folderId;
    if (typeof folderId !== "string") fail(ctx, "internal.unexpected", "The site folder was not created.");
    return folderId;
  };
  try {
    return await attempt(name.replaceAll("/", "-"));
  } catch (e) {
    if (e instanceof VyreErr && e.error.code === "validation.duplicate") return attempt(`${name.replaceAll("/", "-")} (${hex.slice(0, 6)})`);
    throw e;
  }
}

async function sitesCreate(ctx: Ctx, input: unknown): Promise<{ site: SiteOut }> {
  const o = rec(ctx, input);
  const name = cleanName(ctx, reqStr(ctx, o, "name"));
  const kind = reqStr(ctx, o, "kind");
  if (!KINDS.includes(kind)) fail(ctx, "validation.bad_input", "That kind of site is not known.", { field: "kind" });
  const repoRaw = optStr(ctx, o, "repoUrl");
  const repoUrl = repoRaw === undefined ? null : cleanRepoUrl(ctx, repoRaw);
  const templateKit = optStr(ctx, o, "templateKit") ?? null;
  const id = nid(ctx, "sit");
  const hex = hexOf(id);
  const folderId = await deploymentsFolder(ctx, name, hex);
  const now = ctx.now();
  const principal = `svc_site_${hex}`;
  ctx.db.run(
    "INSERT INTO sites_site (id, name, kind, owner, repo_url, repo_folder_id, template_kit, state, settings, staging_secret, service_principal, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    id, name, kind, ctx.principal.id, repoUrl, folderId, templateKit, "queued", "{}", null, principal, now, now, null,
  );
  const folderLevel = cappedLevel(ctx, "folder", folderId);
  if (folderLevel) ctx.db.run("INSERT INTO sites_grant (site_id, resource, level) VALUES (?, ?, ?)", id, `folder/${folderId}`, folderLevel);
  const siteLevel = cappedLevel(ctx, "site", id);
  if (siteLevel) ctx.db.run("INSERT INTO sites_grant (site_id, resource, level) VALUES (?, ?, ?)", id, `site/${id}`, siteLevel);
  noteActivity(ctx, id, "site.created");
  ctx.emit("site.created", `site/${id}`, { siteId: id, name });
  return { site: siteOut(ctx, mustSite(ctx, id)) };
}

async function sitesGet(ctx: Ctx, input: unknown): Promise<{ site: SiteOut }> {
  const o = rec(ctx, input);
  return { site: siteOut(ctx, mustSite(ctx, reqStr(ctx, o, "siteId"))) };
}

async function sitesList(ctx: Ctx, input: unknown): Promise<{ sites: SiteOut[]; next?: string; total: number }> {
  const o = rec(ctx, input);
  const section = optStr(ctx, o, "section");
  if (section !== undefined && section !== "personal" && section !== "shared" && section !== "space") {
    fail(ctx, "validation.bad_input", "That section is not known.", { field: "section" });
  }
  const folderId = optStr(ctx, o, "folderId");
  const { offset, limit } = pageOf(ctx, o);
  const activity = new Map<string, number>();
  for (const a of many(ctx, "SELECT * FROM sites_activity")) activity.set(str(a.site_id), num(a.at));
  let rows = many(ctx, "SELECT * FROM sites_site WHERE deleted_at IS NULL");
  if (folderId !== undefined) rows = rows.filter((r) => r.repo_folder_id === folderId);
  if (section === "personal") rows = rows.filter((r) => r.owner === ctx.principal.id);
  if (section === "shared") rows = rows.filter((r) => r.owner !== ctx.principal.id);
  rows = rows.filter((r) => ctx.authorize({ perm: null, level: "view" }, { type: "site", id: str(r.id) }).effect === "allow");
  rows.sort((a, b) => (activity.get(str(b.id)) ?? num(b.created_at)) - (activity.get(str(a.id)) ?? num(a.created_at)) || str(a.name).localeCompare(str(b.name)) || str(a.id).localeCompare(str(b.id)));
  const slice = rows.slice(offset, offset + limit);
  const out: { sites: SiteOut[]; next?: string; total: number } = { sites: slice.map((r) => siteOut(ctx, r)), total: rows.length };
  if (offset + limit < rows.length) out.next = String(offset + limit);
  return out;
}

async function sitesUpdate(ctx: Ctx, input: unknown): Promise<{ site: SiteOut }> {
  const o = rec(ctx, input);
  const site = mustSite(ctx, reqStr(ctx, o, "siteId"));
  const nameRaw = optStr(ctx, o, "name");
  const name = nameRaw === undefined ? str(site.name) : cleanName(ctx, nameRaw);
  let settings = siteSettings(site);
  const patch = o.settings;
  if (patch !== undefined && patch !== null) {
    if (typeof patch !== "object" || Array.isArray(patch)) fail(ctx, "validation.bad_input", "Settings must be an object.", { field: "settings" });
    const merged: Record<string, unknown> = { ...settings, ...(patch as Record<string, unknown>) };
    const branch = merged.defaultBranch;
    if (branch !== undefined && (typeof branch !== "string" || !/^[A-Za-z0-9._/-]{1,100}$/.test(branch))) {
      fail(ctx, "validation.bad_input", "The default branch name cannot be used.", { field: "settings.defaultBranch" });
    }
    if (JSON.stringify(merged).length > SETTINGS_MAX) fail(ctx, "validation.too_large", "The settings are too large.", { field: "settings" });
    settings = merged;
  }
  ctx.db.run("UPDATE sites_site SET name = ?, settings = ?, updated_at = ? WHERE id = ?", name, JSON.stringify(settings), ctx.now(), site.id);
  return { site: siteOut(ctx, mustSite(ctx, str(site.id))) };
}

async function sitesDelete(ctx: Ctx, input: unknown): Promise<{ deleted: boolean }> {
  const o = rec(ctx, input);
  const site = mustSite(ctx, reqStr(ctx, o, "siteId"));
  const d = configured;
  const deps = many(ctx, "SELECT * FROM sites_deployment WHERE site_id = ?", site.id);
  for (const dep of deps) {
    if (d && !isNull(dep.container_id)) await stopContainer(ctx, d, str(dep.container_id));
    if (d && !isNull(dep.host)) await dropRoute(ctx, d, str(dep.host));
  }
  for (const dom of many(ctx, "SELECT * FROM sites_domain WHERE site_id = ?", site.id)) {
    if (d) await dropRoute(ctx, d, str(dom.domain));
  }
  ctx.db.run("DELETE FROM sites_route WHERE site_id = ?", site.id);
  ctx.db.run("DELETE FROM sites_domain WHERE site_id = ?", site.id);
  ctx.db.run("DELETE FROM sites_env WHERE site_id = ?", site.id);
  const now = ctx.now();
  ctx.db.run("UPDATE sites_deployment SET state = ?, url = ?, container_id = ?, removed_at = ?, updated_at = ? WHERE site_id = ?", "stopped", null, null, now, now, site.id);
  ctx.db.run("UPDATE sites_site SET state = ?, deleted_at = ?, updated_at = ? WHERE id = ?", "stopped", now, now, site.id);
  return { deleted: true };
}

// ---- build ---------------------------------------------------------------------------------------------------

/** Remove the previews a merged pull request marked. Called at the start of every write that touches deployments. */
export async function sweepMergedPreviews(ctx: Ctx, siteId: string): Promise<number> {
  const rows = many(ctx, "SELECT * FROM sites_deployment WHERE site_id = ? AND env = ? AND merge_pending = ? AND removed_at IS NULL", siteId, "preview", 1);
  if (rows.length === 0) return 0;
  const d = siteDrivers(ctx);
  for (const row of rows) await removePreview(ctx, d, row);
  return rows.length;
}

async function removePreview(ctx: Ctx, d: SiteDrivers, row: Row): Promise<void> {
  if (!isNull(row.container_id)) await stopContainer(ctx, d, str(row.container_id));
  if (!isNull(row.host)) await dropRoute(ctx, d, str(row.host));
  const now = ctx.now();
  ctx.db.run(
    "UPDATE sites_deployment SET state = ?, url = ?, container_id = ?, upstream = ?, removed_at = ?, merge_pending = ?, updated_at = ? WHERE id = ?",
    "stopped", null, null, null, now, 0, now, row.id,
  );
  const siteId = str(row.site_id);
  const branch = str(row.branch);
  noteActivity(ctx, siteId, "site.preview_removed");
  ctx.emit("site.preview_removed", `site/${siteId}`, { siteId, branch });
}

/** Branch merged outside a pull request event (a direct push to the default branch also ends a branch preview). */
export async function handleBranchMerged(ctx: Ctx, siteId: string, branch: string): Promise<number> {
  const rows = many(ctx, "SELECT * FROM sites_deployment WHERE site_id = ? AND env = ? AND branch = ? AND removed_at IS NULL", siteId, "preview", branch);
  if (rows.length === 0) return 0;
  const d = siteDrivers(ctx);
  for (const row of rows) await removePreview(ctx, d, row);
  return rows.length;
}

function logLine(r: Row, line: string): string {
  return JSON.stringify(clipLines([...parseLines(r.log), line]));
}

/** Start the container of a built deployment and route it. Never throws on a runtime fault: the deployment is marked failed and build_failed is emitted. */
async function startAndRoute(ctx: Ctx, d: SiteDrivers, site: Row, dep: Row): Promise<Row> {
  const siteId = str(site.id);
  const depId = str(dep.id);
  const env = str(dep.env) as DeployEnv;
  const image = isNull(dep.image) ? "" : str(dep.image);
  if (!image) fail(ctx, "validation.precondition_failed", "That deployment has no build to run. Build the site first.");
  const secret = isNull(site.staging_secret) ? "" : str(site.staging_secret);
  if (env !== "production" && !secret) fail(ctx, "validation.precondition_failed", "Staging is always behind a password. Choose a staging password first.");
  if (secret) vaultUse(ctx, secret);

  const envRows = many(ctx, "SELECT * FROM sites_env WHERE site_id = ?", siteId);
  const envRefs: { name: string; ref: string }[] = [];
  for (const e of envRows) {
    const handle = str(e.vault_handle);
    vaultUse(ctx, handle);
    const ref = `${depId}:${str(e.name)}`;
    await ctx.vault.fill(handle, { kind: "container_env", ref });
    envRefs.push({ name: str(e.name), ref });
  }

  const host = env === "preview" ? previewHost(siteId, str(dep.branch), d.spaceDomain) : stagingHost(siteId, d.spaceDomain);
  let containerId = "";
  try {
    const started = await d.runtime.start({
      siteId, deploymentId: depId, env, image, network: NETWORK, name: `site-${hexOf(siteId)}-${hexOf(depId).slice(0, 12)}`,
      envRefs, servicePrincipal: str(site.service_principal),
    });
    containerId = started.containerId;
    const staged: Row = { ...dep, host, upstream: started.upstream };
    await routeDeployment(ctx, d, site, staged);
    // the route now points at the new container: stop what ran before on this address
    const previous = many(ctx, "SELECT * FROM sites_deployment WHERE site_id = ? AND env = ? AND removed_at IS NULL", siteId, env)
      .filter((p) => p.id !== depId && !isNull(p.container_id) && (env === "staging" || p.branch === dep.branch));
    const now = ctx.now();
    if (!isNull(dep.container_id)) await stopContainer(ctx, d, str(dep.container_id));
    for (const p of previous) {
      await stopContainer(ctx, d, str(p.container_id));
      ctx.db.run("UPDATE sites_deployment SET state = ?, url = ?, container_id = ?, upstream = ?, updated_at = ? WHERE id = ?", "stopped", null, null, null, now, p.id);
    }
    ctx.db.run(
      "UPDATE sites_deployment SET state = ?, url = ?, container_id = ?, host = ?, upstream = ?, updated_at = ? WHERE id = ?",
      "ready", `https://${host}`, containerId, host, started.upstream, now, depId,
    );
    for (const e of envRows) ctx.db.run("UPDATE sites_env SET injected = ? WHERE site_id = ? AND name = ?", 1, siteId, e.name);
    setSiteState(ctx, siteId, "ready");
    noteActivity(ctx, siteId, "site.deployed");
    ctx.emit("site.deployed", `site/${siteId}`, { siteId, deploymentId: depId, env: env === "preview" ? "preview" : "staging" });
  } catch (e) {
    if (e instanceof VyreErr) {
      if (containerId) await stopContainer(ctx, d, containerId);
      throw e;
    }
    if (containerId) await stopContainer(ctx, d, containerId);
    const reason = (e instanceof Error ? e.message : String(e)).slice(0, 300) || "The deployment failed.";
    ctx.db.run("UPDATE sites_deployment SET state = ?, url = ?, container_id = ?, log = ?, updated_at = ? WHERE id = ?", "failed", null, null, logLine(dep, reason), ctx.now(), depId);
    setSiteState(ctx, siteId, "failed");
    noteActivity(ctx, siteId, "site.build_failed");
    ctx.emit("site.build_failed", `site/${siteId}`, { siteId, deploymentId: depId, reason });
  }
  return mustDeployment(ctx, siteId, depId);
}

/** Build a branch. The default branch builds a staging deployment; any other branch builds (and starts) its one preview. */
async function buildBranch(ctx: Ctx, site: Row, branchIn: string | undefined, forcePreview: boolean): Promise<{ dep: Row; env: DeployEnv }> {
  const d = siteDrivers(ctx);
  const siteId = str(site.id);
  await sweepMergedPreviews(ctx, siteId);
  const defaultBranch = defaultBranchOf(site);
  const branch = branchIn === undefined ? defaultBranch : cleanBranch(ctx, branchIn);
  if (forcePreview && branch === defaultBranch) fail(ctx, "validation.bad_input", "The default branch is built as staging, not as a preview.", { field: "branch" });
  const env: DeployEnv = forcePreview || branch !== defaultBranch ? "preview" : "staging";
  const now = ctx.now();

  let depId: string;
  const existing = env === "preview" ? one(ctx, "SELECT * FROM sites_deployment WHERE site_id = ? AND env = ? AND branch = ?", siteId, "preview", branch) : undefined;
  if (existing) {
    depId = str(existing.id);
    if (!isNull(existing.container_id)) await stopContainer(ctx, d, str(existing.container_id));
    ctx.db.run(
      "UPDATE sites_deployment SET state = ?, url = ?, container_id = ?, upstream = ?, image = ?, commit_sha = ?, log = ?, removed_at = ?, merge_pending = ?, at = ?, updated_at = ?, created_by = ? WHERE id = ?",
      "building", null, null, null, null, null, "[]", null, 0, now, now, ctx.principal.id, depId,
    );
  } else {
    depId = nid(ctx, "dpl");
    ctx.db.run(
      "INSERT INTO sites_deployment (id, site_id, env, state, url, branch, commit_sha, image, container_id, host, upstream, pr_number, log, created_by, at, updated_at, removed_at, merge_pending) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      depId, siteId, env, "building", null, branch, null, null, null, null, null, null, "[]", ctx.principal.id, now, now, null, 0,
    );
  }
  setSiteState(ctx, siteId, "building");

  let result: BuildResult;
  try {
    result = await d.runtime.build({
      siteId, deploymentId: depId, kind: str(site.kind) as SiteKind, repoUrl: isNull(site.repo_url) ? null : str(site.repo_url),
      folderId: isNull(site.repo_folder_id) ? null : str(site.repo_folder_id), branch,
    });
  } catch (e) {
    result = { ok: false, log: [e instanceof Error ? e.message : String(e)] };
  }
  const log = JSON.stringify(clipLines(result.log));
  if (!result.ok || !result.image) {
    const reason = (result.log[result.log.length - 1] ?? "The build failed.").slice(0, 300);
    ctx.db.run("UPDATE sites_deployment SET state = ?, log = ?, updated_at = ? WHERE id = ?", "failed", log, ctx.now(), depId);
    setSiteState(ctx, siteId, "failed");
    noteActivity(ctx, siteId, "site.build_failed");
    ctx.emit("site.build_failed", `site/${siteId}`, { siteId, deploymentId: depId, reason });
    return { dep: mustDeployment(ctx, siteId, depId), env };
  }
  ctx.db.run(
    "UPDATE sites_deployment SET state = ?, image = ?, commit_sha = ?, pr_number = ?, log = ?, updated_at = ? WHERE id = ?",
    "ready", result.image, result.commit ?? null, result.pullRequest ?? null, log, ctx.now(), depId,
  );
  setSiteState(ctx, siteId, "ready");

  if (env === "preview") {
    let dep = mustDeployment(ctx, siteId, depId);
    if (isNull(site.staging_secret)) {
      ctx.db.run("UPDATE sites_deployment SET log = ? WHERE id = ?", logLine(dep, "Preview not started: choose a staging password to serve previews."), depId);
      return { dep: mustDeployment(ctx, siteId, depId), env };
    }
    dep = await startAndRoute(ctx, d, site, dep);
    if (dep.state === "ready" && !isNull(dep.url)) {
      noteActivity(ctx, siteId, "site.preview_created");
      ctx.emit("site.preview_created", `site/${siteId}`, { siteId, branch, url: str(dep.url) });
    }
    return { dep, env };
  }
  return { dep: mustDeployment(ctx, siteId, depId), env };
}

async function sitesBuild(ctx: Ctx, input: unknown): Promise<{ runId: string; deploymentId: string }> {
  const o = rec(ctx, input);
  const site = mustSite(ctx, reqStr(ctx, o, "siteId"));
  const branch = optStr(ctx, o, "branch");
  const { dep } = await buildBranch(ctx, site, branch, false);
  return { runId: ctx.run ?? nid(ctx, "run"), deploymentId: str(dep.id) };
}

// ---- deploy, deployments, previews ---------------------------------------------------------------------------

async function sitesDeploy(ctx: Ctx, input: unknown): Promise<{ deployment: DeploymentOut }> {
  const o = rec(ctx, input);
  const site = mustSite(ctx, reqStr(ctx, o, "siteId"));
  const d = siteDrivers(ctx);
  await sweepMergedPreviews(ctx, str(site.id));
  const wanted = optStr(ctx, o, "deploymentId");
  let dep: Row | undefined;
  if (wanted !== undefined) {
    dep = mustDeployment(ctx, str(site.id), wanted);
    if (dep.env === "production") fail(ctx, "validation.precondition_failed", "A production deployment is changed with Promote, not Deploy.");
    if (!isNull(dep.removed_at)) fail(ctx, "validation.precondition_failed", "That preview was removed. Rebuild it first.");
  } else {
    dep = newest(many(ctx, "SELECT * FROM sites_deployment WHERE site_id = ? AND env = ? AND removed_at IS NULL", site.id, "staging").filter((r) => !isNull(r.image)));
  }
  if (!dep || isNull(dep.image) || (dep.state !== "ready" && dep.state !== "stopped")) {
    fail(ctx, "validation.precondition_failed", "Nothing is built yet. Build the site first.");
  }
  const out = await startAndRoute(ctx, d, site, dep);
  return { deployment: depOut(out) };
}

async function sitesDeployments(ctx: Ctx, input: unknown): Promise<{ deployments: DeploymentOut[]; next?: string; total: number }> {
  const o = rec(ctx, input);
  const site = mustSite(ctx, reqStr(ctx, o, "siteId"));
  const { offset, limit } = pageOf(ctx, o);
  const rows = many(ctx, "SELECT * FROM sites_deployment WHERE site_id = ? AND removed_at IS NULL", site.id)
    .filter((r) => !flag(r.merge_pending))
    .sort((a, b) => num(b.at) - num(a.at) || str(b.id).localeCompare(str(a.id)));
  const out: { deployments: DeploymentOut[]; next?: string; total: number } = { deployments: rows.slice(offset, offset + limit).map(depOut), total: rows.length };
  if (offset + limit < rows.length) out.next = String(offset + limit);
  return out;
}

async function sitesPreviews(ctx: Ctx, input: unknown): Promise<{ previews: DeploymentOut[] }> {
  const o = rec(ctx, input);
  const site = mustSite(ctx, reqStr(ctx, o, "siteId"));
  const rows = many(ctx, "SELECT * FROM sites_deployment WHERE site_id = ? AND env = ? AND removed_at IS NULL", site.id, "preview")
    .filter((r) => !flag(r.merge_pending))
    .sort((a, b) => num(b.at) - num(a.at) || str(b.id).localeCompare(str(a.id)));
  return { previews: rows.map(depOut) };
}

async function sitesPreviewRebuild(ctx: Ctx, input: unknown): Promise<{ deployment: DeploymentOut }> {
  const o = rec(ctx, input);
  const site = mustSite(ctx, reqStr(ctx, o, "siteId"));
  const { dep } = await buildBranch(ctx, site, reqStr(ctx, o, "branch"), true);
  return { deployment: depOut(dep) };
}

async function sitesPreviewRemove(ctx: Ctx, input: unknown): Promise<{ removed: boolean }> {
  const o = rec(ctx, input);
  const site = mustSite(ctx, reqStr(ctx, o, "siteId"));
  const branch = cleanBranch(ctx, reqStr(ctx, o, "branch"));
  const row = one(ctx, "SELECT * FROM sites_deployment WHERE site_id = ? AND env = ? AND branch = ? AND removed_at IS NULL", site.id, "preview", branch);
  if (!row) return { removed: false };
  await removePreview(ctx, siteDrivers(ctx), row);
  return { removed: true };
}

// ---- environment, staging password, identity, logs -----------------------------------------------------------

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const HANDLE = /^#[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)?$/;

async function sitesEnvSet(ctx: Ctx, input: unknown): Promise<{ ok: boolean }> {
  const o = rec(ctx, input);
  const site = mustSite(ctx, reqStr(ctx, o, "siteId"));
  const entries = o.entries;
  if (!Array.isArray(entries)) fail(ctx, "validation.bad_input", "The entries are not valid.", { field: "entries" });
  if (entries.length > 200) fail(ctx, "validation.too_large", "A site takes at most 200 environment names.", { field: "entries" });
  const seen = new Set<string>();
  const next: { name: string; handle: string }[] = [];
  for (const e of entries) {
    const row = rec(ctx, e);
    const name = reqStr(ctx, row, "name");
    const handle = reqStr(ctx, row, "vaultHandle");
    if (!ENV_NAME.test(name)) fail(ctx, "validation.bad_input", "An environment name uses letters, digits and underscores.", { field: "entries.name", name });
    if (!HANDLE.test(handle)) fail(ctx, "validation.bad_input", "A Vault key is written as #Name or #Name.field.", { field: "entries.vaultHandle", name });
    if (seen.has(name)) fail(ctx, "validation.duplicate", "An environment name is listed twice.", { name });
    seen.add(name);
    next.push({ name, handle });
  }
  for (const e of next) vaultUse(ctx, e.handle);
  const before = new Map<string, Row>();
  for (const r of many(ctx, "SELECT * FROM sites_env WHERE site_id = ?", site.id)) before.set(str(r.name), r);
  ctx.db.run("DELETE FROM sites_env WHERE site_id = ?", site.id);
  for (const e of next) {
    const prev = before.get(e.name);
    const unchanged = prev !== undefined && prev.vault_handle === e.handle;
    ctx.db.run("INSERT INTO sites_env (site_id, name, vault_handle, injected) VALUES (?, ?, ?, ?)", site.id, e.name, e.handle, unchanged && flag(prev.injected) ? 1 : 0);
  }
  ctx.db.run("UPDATE sites_site SET updated_at = ? WHERE id = ?", ctx.now(), site.id);
  return { ok: true };
}

async function sitesEnvList(ctx: Ctx, input: unknown): Promise<{ entries: { name: string; vaultName: string; injected: boolean }[] }> {
  const o = rec(ctx, input);
  const site = mustSite(ctx, reqStr(ctx, o, "siteId"));
  const rows = many(ctx, "SELECT * FROM sites_env WHERE site_id = ?", site.id).sort((a, b) => str(a.name).localeCompare(str(b.name)));
  return { entries: rows.map((r) => ({ name: str(r.name), vaultName: str(r.vault_handle), injected: flag(r.injected) })) };
}

async function sitesStagingPasswordSet(ctx: Ctx, input: unknown): Promise<{ ok: boolean }> {
  const o = rec(ctx, input);
  const site = mustSite(ctx, reqStr(ctx, o, "siteId"));
  const handle = reqStr(ctx, o, "vaultHandle");
  if (!HANDLE.test(handle)) fail(ctx, "validation.bad_input", "A Vault key is written as #Name or #Name.field.", { field: "vaultHandle" });
  vaultUse(ctx, handle);
  ctx.db.run("UPDATE sites_site SET staging_secret = ?, updated_at = ? WHERE id = ?", handle, ctx.now(), site.id);
  // previews share the key: every live staging and preview address switches to it
  const live = many(ctx, "SELECT * FROM sites_deployment WHERE site_id = ? AND removed_at IS NULL", site.id)
    .filter((r) => r.env !== "production" && !isNull(r.container_id) && !isNull(r.upstream) && !isNull(r.host));
  if (live.length > 0) {
    const d = siteDrivers(ctx);
    const fresh = mustSite(ctx, str(site.id));
    for (const dep of live) await routeDeployment(ctx, d, fresh, dep);
  }
  return { ok: true };
}

async function sitesServiceIdentity(ctx: Ctx, input: unknown): Promise<{ principal: string; grants: { resource: string; level: string }[] }> {
  const o = rec(ctx, input);
  const site = mustSite(ctx, reqStr(ctx, o, "siteId"));
  const grants = many(ctx, "SELECT * FROM sites_grant WHERE site_id = ?", site.id).sort((a, b) => str(a.resource).localeCompare(str(b.resource)));
  return { principal: str(site.service_principal), grants: grants.map((g) => ({ resource: str(g.resource), level: str(g.level) })) };
}

async function sitesLogs(ctx: Ctx, input: unknown): Promise<{ lines: string[] }> {
  const o = rec(ctx, input);
  const site = mustSite(ctx, reqStr(ctx, o, "siteId"));
  const tail = optInt(ctx, o, "tail") ?? 200;
  if (tail < 1 || tail > 1000) fail(ctx, "validation.bad_input", "Tail is between 1 and 1000 lines.", { field: "tail" });
  const wanted = optStr(ctx, o, "deploymentId");
  const dep = wanted !== undefined
    ? mustDeployment(ctx, str(site.id), wanted)
    : newest(many(ctx, "SELECT * FROM sites_deployment WHERE site_id = ?", site.id));
  if (!dep) return { lines: [] };
  const stored = parseLines(dep.log);
  let running: string[] = [];
  if (!isNull(dep.container_id) && configured) {
    try {
      running = await configured.runtime.logs(str(dep.container_id), tail);
    } catch (e) {
      ctx.log.warn("sites: container logs unavailable", { error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { lines: [...stored, ...running].slice(-tail) };
}

export const deployHandlers = {
  "sites.create": (ctx: Ctx, input: unknown) => sitesCreate(ctx, input),
  "sites.get": (ctx: Ctx, input: unknown) => sitesGet(ctx, input),
  "sites.list": (ctx: Ctx, input: unknown) => sitesList(ctx, input),
  "sites.update": (ctx: Ctx, input: unknown) => sitesUpdate(ctx, input),
  "sites.delete": (ctx: Ctx, input: unknown) => sitesDelete(ctx, input),
  "sites.build": (ctx: Ctx, input: unknown) => sitesBuild(ctx, input),
  "sites.deploy": (ctx: Ctx, input: unknown) => sitesDeploy(ctx, input),
  "sites.deployments": (ctx: Ctx, input: unknown) => sitesDeployments(ctx, input),
  "sites.previews": (ctx: Ctx, input: unknown) => sitesPreviews(ctx, input),
  "sites.preview_rebuild": (ctx: Ctx, input: unknown) => sitesPreviewRebuild(ctx, input),
  "sites.preview_remove": (ctx: Ctx, input: unknown) => sitesPreviewRemove(ctx, input),
  "sites.env_set": (ctx: Ctx, input: unknown) => sitesEnvSet(ctx, input),
  "sites.env_list": (ctx: Ctx, input: unknown) => sitesEnvList(ctx, input),
  "sites.staging_password_set": (ctx: Ctx, input: unknown) => sitesStagingPasswordSet(ctx, input),
  "sites.service_identity": (ctx: Ctx, input: unknown) => sitesServiceIdentity(ctx, input),
  "sites.logs": (ctx: Ctx, input: unknown) => sitesLogs(ctx, input),
};
