// Sites deploy path (spec 2.20, ARCH 7.6). Docker and Caddy are reached through ctx.platform
// (boundary B8). This module never imports host/src/caddy.ts.
// A staging or preview route exists only while the site's Vault handle still unseals.
// The handler never sees the secret: it seals a binding and passes the handle to the route.
import { mintId } from "../../../lib/ids.ts";
import type { Ctx, Sealed } from "../../../packages/contracts/src/ctx.ts";
import { ERROR_CODES, VyreErr } from "../../../packages/contracts/src/errors.ts";
import type { ErrorCode, Level } from "../../../packages/contracts/src/types.ts";

export const NETWORK = "vyre-sites" as const;

const NEXT_LABEL: Record<string, string> = {
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

export function raise(code: ErrorCode, traceId: string, message?: string): never {
  const def = ERROR_CODES.find((row) => row.code === code);
  if (!def) throw new Error(`unknown error code ${code}`);
  throw new VyreErr({
    code,
    message: message ?? def.what,
    retryable: def.retryable,
    traceId,
    next: def.next.map((kind) => ({ kind, label: NEXT_LABEL[kind] ?? kind })),
  });
}

export type Kind = "site" | "app" | "api" | "worker" | "artifact";
export type SiteState = "queued" | "building" | "ready" | "failed" | "stopped";
export type DeployEnv = "staging" | "preview" | "production";
export type CertificateState = "pending" | "issued" | "failed";
type SqlVal = string | number | null;
type Db = Ctx["db"];

export const TABLES = {
  site: "sites_site",
  deployment: "sites_deployment",
  env: "sites_env",
  domain: "sites_domain",
  log: "sites_log",
  grant: "sites_grant",
} as const;

const SITE_COLS = [
  "site_id", "name", "kind", "owner", "repo_url", "template_kit", "repo_folder_id", "root_folder",
  "staging_url", "production_url", "state", "staging_vault_handle", "staging_seal", "service_principal",
  "owner_level", "builder", "idempotency_key", "settings", "deleted", "created_at",
] as const;

const DEP_COLS = [
  "deployment_id", "site_id", "env", "state", "url", "branch", "commit_sha", "at", "sealed",
  "vault_handle", "container_name", "network", "removed", "image", "checks", "run_id",
] as const;

const CHECKS_BUILT = JSON.stringify([{ name: "build", ok: true }, { name: "verify", ok: true }]);
const CHECKS_FAILED = JSON.stringify([{ name: "build", ok: false }, { name: "verify", ok: false }]);
const CHECKS_SEALED = JSON.stringify([
  { name: "build", ok: true },
  { name: "verify", ok: true },
  { name: "staging-auth", ok: true },
]);

export interface SiteRow {
  site_id: string;
  name: string;
  kind: Kind;
  owner: string;
  repo_url: string | null;
  template_kit: string | null;
  repo_folder_id: string | null;
  root_folder: string;
  staging_url: string | null;
  production_url: string | null;
  state: SiteState;
  staging_vault_handle: string | null;
  staging_seal: string | null;
  service_principal: string;
  owner_level: Level;
  builder: "node" | "static" | "python";
  idempotency_key: string | null;
  settings: string;
  deleted: number;
  created_at: number;
}

interface DeploymentRow {
  deployment_id: string;
  site_id: string;
  env: DeployEnv;
  state: SiteState;
  url: string | null;
  branch: string | null;
  commit_sha: string | null;
  at: number;
  sealed: number;
  vault_handle: string | null;
  container_name: string;
  network: typeof NETWORK;
  removed: number;
  image: string;
  checks: string;
  run_id: string;
}

interface SiteBody {
  siteId: string;
  name: string;
  kind: Kind;
  owner: string;
  repoFolderId?: string;
  stagingUrl?: string;
  productionUrl?: string;
  state: SiteState;
}

interface DeploymentBody {
  deploymentId: string;
  siteId: string;
  env: DeployEnv;
  state: SiteState;
  url?: string;
  branch?: string;
  commit?: string;
  at: number;
}

export interface ContainerSpec {
  name: string;
  network: typeof NETWORK;
  image: string;
  siteId: string;
  envNames: string[];
}

export type RouteAuth = { sealed: true; vaultHandle: string } | { sealed: false };

export interface SiteRoute {
  host: string;
  upstream: string;
  network: typeof NETWORK;
  auth: RouteAuth;
}

export interface BuildSpec {
  siteId: string;
  branch: string;
  image: string;
  commit: string;
}

export type BuildResult = { ok: true; image: string; commit: string } | { ok: false; reason: string };

export interface SitePlatform {
  ensureNetwork(name: typeof NETWORK): Promise<void>;
  startContainer(spec: ContainerSpec): Promise<{ containerId: string }>;
  stopContainer(name: string): Promise<void>;
  upsertRoute(route: SiteRoute): Promise<void>;
  removeRoute(host: string): Promise<void>;
  dnsCheck(domain: string): Promise<boolean>;
  certificate(domain: string): Promise<CertificateState>;
  build(spec: BuildSpec): Promise<BuildResult>;
}

export interface MemoryContainer {
  name: string;
  network: typeof NETWORK;
  image: string;
  siteId: string;
  envNames: string[];
  running: boolean;
}

export interface MemoryPlatform extends SitePlatform {
  networks: string[];
  containers: MemoryContainer[];
  routes: SiteRoute[];
  dns: Map<string, boolean>;
  certs: Map<string, CertificateState>;
  failNext(reason: string): void;
}

export function memoryPlatform(): MemoryPlatform {
  const networks: string[] = [];
  const containers: MemoryContainer[] = [];
  const routes: SiteRoute[] = [];
  const dns = new Map<string, boolean>();
  const certs = new Map<string, CertificateState>();
  let failReason: string | null = null;
  return {
    networks,
    containers,
    routes,
    dns,
    certs,
    failNext(reason: string) { failReason = reason; },
    async ensureNetwork(name) {
      if (name !== NETWORK) throw new Error("sites use the vyre-sites network");
      if (!networks.includes(name)) networks.push(name);
    },
    async startContainer(spec) {
      if (spec.network !== NETWORK) throw new Error("sites use the vyre-sites network");
      const found = containers.find((row) => row.name === spec.name);
      if (found) {
        found.running = true;
        found.image = spec.image;
        found.envNames = spec.envNames.slice();
        found.network = spec.network;
        return { containerId: spec.name };
      }
      containers.push({
        name: spec.name,
        network: spec.network,
        image: spec.image,
        siteId: spec.siteId,
        envNames: spec.envNames.slice(),
        running: true,
      });
      return { containerId: spec.name };
    },
    async stopContainer(name) {
      const found = containers.find((row) => row.name === name);
      if (found) found.running = false;
    },
    async upsertRoute(route) {
      const at = routes.findIndex((row) => row.host === route.host);
      if (at >= 0) routes[at] = route;
      else routes.push(route);
    },
    async removeRoute(host) {
      const at = routes.findIndex((row) => row.host === host);
      if (at >= 0) routes.splice(at, 1);
    },
    async dnsCheck(domain) { return dns.get(domain) ?? false; },
    async certificate(domain) {
      const set = certs.get(domain);
      if (set) return set;
      return dns.get(domain) ? "pending" : "failed";
    },
    async build(spec) {
      if (failReason) {
        const reason = failReason;
        failReason = null;
        return { ok: false, reason };
      }
      return { ok: true, image: spec.image, commit: spec.commit };
    },
  };
}

const attached = new WeakMap<object, SitePlatform>();

export function platformOf(ctx: Ctx): SitePlatform {
  const given = (ctx as Ctx & { platform?: SitePlatform }).platform;
  if (given) return given;
  const found = attached.get(ctx);
  if (found) return found;
  const created = memoryPlatform();
  attached.set(ctx, created);
  return created;
}

function tableName(name: string): string {
  if (!/^sites_[a-z0-9_]+$/.test(name)) throw new Error(`table ${name} is outside sites_`);
  return name;
}

export function insert(db: Db, table: string, row: Record<string, SqlVal>): void {
  const cols = Object.keys(row);
  const sql = `INSERT INTO ${tableName(table)} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`;
  db.run(sql, ...cols.map((col) => row[col] ?? null));
}

export function update(db: Db, table: string, set: Record<string, SqlVal>, where: Record<string, SqlVal>): { changes: number } {
  const setCols = Object.keys(set);
  const whereCols = Object.keys(where);
  const sql = `UPDATE ${tableName(table)} SET ${setCols.map((col) => `${col} = ?`).join(", ")} WHERE ${whereCols.map((col) => `${col} = ?`).join(" AND ")}`;
  return db.run(sql, ...setCols.map((col) => set[col] ?? null), ...whereCols.map((col) => where[col] ?? null));
}

export function select(db: Db, table: string, cols: readonly string[], where: Record<string, SqlVal>, order?: { col: string; dir: "ASC" | "DESC" }): Record<string, SqlVal>[] {
  const whereCols = Object.keys(where);
  let sql = `SELECT ${cols.join(", ")} FROM ${tableName(table)}`;
  const args: SqlVal[] = [];
  if (whereCols.length) {
    sql += ` WHERE ${whereCols.map((col) => `${col} = ?`).join(" AND ")}`;
    for (const col of whereCols) args.push(where[col] ?? null);
  }
  if (order) sql += ` ORDER BY ${order.col} ${order.dir}`;
  return db.all(sql, ...args) as Record<string, SqlVal>[];
}

export function deleteRows(db: Db, table: string, where: Record<string, SqlVal>): void {
  const whereCols = Object.keys(where);
  const sql = `DELETE FROM ${tableName(table)} WHERE ${whereCols.map((col) => `${col} = ?`).join(" AND ")}`;
  db.run(sql, ...whereCols.map((col) => where[col] ?? null));
}

function str(raw: Record<string, SqlVal>, key: string): string {
  const value = raw[key];
  if (typeof value !== "string") throw new Error(`sites column ${key} is not text`);
  return value;
}

function strOrNull(raw: Record<string, SqlVal>, key: string): string | null {
  const value = raw[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new Error(`sites column ${key} is not text`);
  return value;
}

function num(raw: Record<string, SqlVal>, key: string): number {
  const value = raw[key];
  if (typeof value !== "number") throw new Error(`sites column ${key} is not a number`);
  return value;
}

function isKind(value: unknown): value is Kind {
  return value === "site" || value === "app" || value === "api" || value === "worker" || value === "artifact";
}

function asKind(value: string): Kind {
  if (isKind(value)) return value;
  throw new Error(`bad site kind ${value}`);
}

function asState(value: string): SiteState {
  if (value === "queued" || value === "building" || value === "ready" || value === "failed" || value === "stopped") return value;
  throw new Error(`bad site state ${value}`);
}

function asEnv(value: string): DeployEnv {
  if (value === "staging" || value === "preview" || value === "production") return value;
  throw new Error(`bad deployment env ${value}`);
}

function asLevel(value: string): Level {
  if (value === "view" || value === "use" || value === "edit" || value === "manage") return value;
  throw new Error(`bad level ${value}`);
}

function asBuilder(value: string): SiteRow["builder"] {
  if (value === "node" || value === "static" || value === "python") return value;
  throw new Error(`bad builder ${value}`);
}

function asSite(raw: Record<string, SqlVal>): SiteRow {
  return {
    site_id: str(raw, "site_id"),
    name: str(raw, "name"),
    kind: asKind(str(raw, "kind")),
    owner: str(raw, "owner"),
    repo_url: strOrNull(raw, "repo_url"),
    template_kit: strOrNull(raw, "template_kit"),
    repo_folder_id: strOrNull(raw, "repo_folder_id"),
    root_folder: str(raw, "root_folder"),
    staging_url: strOrNull(raw, "staging_url"),
    production_url: strOrNull(raw, "production_url"),
    state: asState(str(raw, "state")),
    staging_vault_handle: strOrNull(raw, "staging_vault_handle"),
    staging_seal: strOrNull(raw, "staging_seal"),
    service_principal: str(raw, "service_principal"),
    owner_level: asLevel(str(raw, "owner_level")),
    builder: asBuilder(str(raw, "builder")),
    idempotency_key: strOrNull(raw, "idempotency_key"),
    settings: str(raw, "settings"),
    deleted: num(raw, "deleted"),
    created_at: num(raw, "created_at"),
  };
}

function asDeployment(raw: Record<string, SqlVal>): DeploymentRow {
  return {
    deployment_id: str(raw, "deployment_id"),
    site_id: str(raw, "site_id"),
    env: asEnv(str(raw, "env")),
    state: asState(str(raw, "state")),
    url: strOrNull(raw, "url"),
    branch: strOrNull(raw, "branch"),
    commit_sha: strOrNull(raw, "commit_sha"),
    at: num(raw, "at"),
    sealed: num(raw, "sealed"),
    vault_handle: strOrNull(raw, "vault_handle"),
    container_name: str(raw, "container_name"),
    network: NETWORK,
    removed: num(raw, "removed"),
    image: str(raw, "image"),
    checks: str(raw, "checks"),
    run_id: str(raw, "run_id"),
  };
}

export function builderFor(kind: Kind): SiteRow["builder"] {
  if (kind === "artifact") return "static";
  if (kind === "worker") return "python";
  return "node";
}

export function branchSlug(branch: string): string {
  const slug = branch.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return slug || "branch";
}

export function spaceHost(space: string): string {
  const label = space.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return `${label || "space"}.vyre.test`;
}

export function stagingHost(siteId: string, space: string): string {
  return `staging-${siteId}.${spaceHost(space)}`;
}

export function previewHost(siteId: string, branch: string, space: string): string {
  return `preview-${branchSlug(branch)}-${siteId}.${spaceHost(space)}`;
}

export function siteContainer(siteId: string): string {
  return `vyre-site-${siteId}`;
}

export function previewContainer(siteId: string, branch: string): string {
  return `vyre-preview-${siteId}-${branchSlug(branch)}`;
}

export function hostFromUrl(url: string): string {
  return url.replace(/^https:\/\//, "").replace(/\/.*$/, "");
}

function imageFor(builder: string): string {
  return `vyre/site-builders:${builder}`;
}

function commitOf(branch: string, at: number): string {
  let hash = 2166136261;
  const text = `${branch}:${at}`;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function checkName(name: string, traceId: string): void {
  if (name.trim() !== name || name.length < 1 || name.length > 80 || /[/\\]/.test(name)) {
    raise("validation.bad_input", traceId, "Site names are 1 to 80 characters without a slash.");
  }
}

function checkBranch(branch: string, traceId: string): void {
  if (branch.length < 1 || branch.length > 200 || branch.includes("..") || branch.startsWith("/") || branch.endsWith("/")) {
    raise("validation.bad_input", traceId, "That branch name cannot be built.");
  }
  if (!/^[A-Za-z0-9._/-]+$/.test(branch)) raise("validation.bad_input", traceId, "That branch name cannot be built.");
}

function isHandle(value: string): boolean {
  return /^[#A-Za-z0-9_.:-]{1,200}$/.test(value);
}

function siteOut(row: SiteRow): SiteBody {
  const site: SiteBody = {
    siteId: row.site_id,
    name: row.name,
    kind: row.kind,
    owner: row.owner,
    state: row.state,
  };
  if (row.repo_folder_id) site.repoFolderId = row.repo_folder_id;
  if (row.staging_url) site.stagingUrl = row.staging_url;
  if (row.production_url) site.productionUrl = row.production_url;
  return site;
}

function deploymentOut(row: DeploymentRow): DeploymentBody {
  const deployment: DeploymentBody = {
    deploymentId: row.deployment_id,
    siteId: row.site_id,
    env: row.env,
    state: row.state,
    at: row.at,
  };
  if (row.url) deployment.url = row.url;
  if (row.branch) deployment.branch = row.branch;
  if (row.commit_sha) deployment.commit = row.commit_sha;
  return deployment;
}

export function requireSite(ctx: Ctx, siteId: string): SiteRow {
  if (!siteId) raise("validation.bad_input", ctx.trace.traceId, "A site id is required.");
  const raw = select(ctx.db, TABLES.site, SITE_COLS, { site_id: siteId, deleted: 0 })[0];
  if (!raw) raise("validation.not_found", ctx.trace.traceId, "That site does not exist.");
  return asSite(raw);
}

function ownerCap(ctx: Ctx): Level {
  const levels: Level[] = ["view", "use", "edit", "manage"];
  let cap: Level | null = null;
  for (const level of levels) {
    const decision = ctx.authorize({ perm: "sites.deploy", level }, { type: "space", id: ctx.space });
    if (decision.effect === "allow") cap = level;
  }
  if (!cap) raise("permission.no_grant", ctx.trace.traceId);
  return cap;
}

function writeGrants(ctx: Ctx, siteId: string, folderId: string, level: Level): void {
  deleteRows(ctx.db, TABLES.grant, { site_id: siteId });
  insert(ctx.db, TABLES.grant, { site_id: siteId, resource: siteId, level });
  insert(ctx.db, TABLES.grant, { site_id: siteId, resource: folderId, level });
}

function readSeal(raw: string): Sealed | null {
  try {
    const value = JSON.parse(raw) as Partial<Sealed>;
    if (value && typeof value.keyId === "string" && typeof value.nonce === "string" && typeof value.bytes === "string") {
      return { keyId: value.keyId, nonce: value.nonce, bytes: value.bytes };
    }
  } catch { /* stored seal is JSON */ }
  return null;
}

function bindSeal(ctx: Ctx, siteId: string, handle: string): string {
  const bytes = new TextEncoder().encode(`sealed:${handle}`);
  return JSON.stringify(ctx.seal.seal(bytes, `sites:${siteId}:staging`));
}

function sealMatches(ctx: Ctx, raw: string | null, handle: string | null): boolean {
  if (!raw || !handle) return false;
  const sealed = readSeal(raw);
  if (!sealed) return false;
  try {
    const back = new TextDecoder().decode(ctx.seal.unseal(sealed));
    return back === `sealed:${handle}`;
  } catch {
    return false;
  }
}

function useVault(ctx: Ctx, handle: string): void {
  try {
    ctx.vault.use(handle);
  } catch (error) {
    if (error instanceof VyreErr) throw error;
    raise("permission.no_grant", ctx.trace.traceId);
  }
}

function envNames(ctx: Ctx, siteId: string): string[] {
  return select(ctx.db, TABLES.env, ["name", "vault_handle", "vault_name", "injected", "site_id"], { site_id: siteId }).map((row) => str(row, "name"));
}

async function injectEnv(ctx: Ctx, siteId: string, deploymentId: string): Promise<void> {
  const rows = select(ctx.db, TABLES.env, ["site_id", "name", "vault_handle", "vault_name", "injected"], { site_id: siteId });
  for (const row of rows) {
    const handle = str(row, "vault_handle");
    const name = str(row, "name");
    useVault(ctx, handle);
    try {
      await ctx.vault.fill(handle, { kind: "deployment", ref: `${deploymentId}:${name}` });
    } catch (error) {
      if (error instanceof VyreErr) throw error;
      raise("permission.no_grant", ctx.trace.traceId);
    }
  }
}

function deploymentsOf(ctx: Ctx, siteId: string): DeploymentRow[] {
  return select(ctx.db, TABLES.deployment, DEP_COLS, { site_id: siteId }, { col: "at", dir: "DESC" }).map(asDeployment);
}

function previewRow(ctx: Ctx, siteId: string, branch: string): DeploymentRow | null {
  const raw = select(ctx.db, TABLES.deployment, DEP_COLS, { site_id: siteId, branch, env: "preview" })[0];
  return raw ? asDeployment(raw) : null;
}

function addLog(ctx: Ctx, deploymentId: string, line: string): void {
  const rows = select(ctx.db, TABLES.log, ["deployment_id", "seq", "line"], { deployment_id: deploymentId }, { col: "seq", dir: "DESC" });
  const top = rows[0];
  const seq = top ? num(top, "seq") + 1 : 1;
  insert(ctx.db, TABLES.log, { deployment_id: deploymentId, seq, line });
}

export async function republish(ctx: Ctx, siteId: string, drop: string[] = []): Promise<void> {
  const site = requireSite(ctx, siteId);
  const platform = platformOf(ctx);
  const deployments = deploymentsOf(ctx, siteId);
  const domains = select(ctx.db, TABLES.domain, ["site_id", "domain", "dns_ok", "certificate"], { site_id: siteId });
  const known = new Set<string>(drop);
  known.add(stagingHost(site.site_id, ctx.space));
  if (site.production_url) known.add(hostFromUrl(site.production_url));
  for (const dep of deployments) if (dep.url) known.add(hostFromUrl(dep.url));
  for (const domain of domains) known.add(str(domain, "domain"));
  for (const host of known) await platform.removeRoute(host);

  const handle = site.staging_vault_handle;
  if (!handle || !sealMatches(ctx, site.staging_seal, handle)) return;
  await platform.ensureNetwork(NETWORK);
  const names = envNames(ctx, siteId);
  const image = imageFor(site.builder);
  const wanted: SiteRoute[] = [];
  for (const dep of deployments) {
    if (dep.removed === 1 || dep.state !== "ready" || !dep.url) continue;
    if (dep.env !== "staging" && dep.env !== "preview") continue;
    wanted.push({
      host: hostFromUrl(dep.url),
      upstream: dep.container_name,
      network: NETWORK,
      auth: { sealed: true, vaultHandle: handle },
    });
  }
  for (const domain of domains) {
    wanted.push({
      host: str(domain, "domain"),
      upstream: siteContainer(site.site_id),
      network: NETWORK,
      auth: { sealed: true, vaultHandle: handle },
    });
  }
  const started = new Set<string>();
  for (const route of wanted) {
    if (!started.has(route.upstream)) {
      await platform.startContainer({ name: route.upstream, network: NETWORK, image, siteId: site.site_id, envNames: names });
      started.add(route.upstream);
    }
    await ctx.vault.fill(route.auth.sealed ? route.auth.vaultHandle : handle, { kind: "caddy-basicauth", ref: route.host });
    await platform.upsertRoute(route);
  }
}

async function refuseUnsealed(ctx: Ctx, site: SiteRow): Promise<void> {
  if (sealMatches(ctx, site.staging_seal, site.staging_vault_handle)) return;
  await republish(ctx, site.site_id);
  raise("validation.bad_input", ctx.trace.traceId, "Staging is behind a sealed Vault key. Set it before deploy.");
}

function page<T>(rows: T[], cursor: string | undefined, limit: number | undefined, traceId: string): { slice: T[]; next?: string; total: number } {
  const total = rows.length;
  const start = cursor === undefined ? 0 : Number(cursor);
  if (!Number.isInteger(start) || start < 0) raise("validation.bad_input", traceId, "The cursor is not a page index.");
  const size = limit ?? 50;
  if (!Number.isInteger(size) || size < 1 || size > 200) raise("validation.bad_input", traceId, "The page size is between 1 and 200.");
  const slice = rows.slice(start, start + size);
  const out: { slice: T[]; next?: string; total: number } = { slice, total };
  if (start + slice.length < total) out.next = String(start + slice.length);
  return out;
}

function readSettings(raw: string): Record<string, unknown> {
  try {
    const value = JSON.parse(raw) as unknown;
    if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch { /* settings stay an object */ }
  return {};
}

async function create(ctx: Ctx, input: { name: string; kind: string; repoUrl?: string; templateKit?: string; idempotencyKey: string }): Promise<{ site: SiteBody }> {
  const traceId = ctx.trace.traceId;
  if (typeof input.name !== "string") raise("validation.bad_input", traceId, "Site names are 1 to 80 characters without a slash.");
  checkName(input.name, traceId);
  if (typeof input.idempotencyKey !== "string" || input.idempotencyKey.length < 1) {
    raise("validation.bad_input", traceId, "An idempotency key is required.");
  }
  if (!isKind(input.kind)) raise("validation.bad_input", traceId, "That site kind is not supported.");
  const kind = input.kind;
  const prior = select(ctx.db, TABLES.site, SITE_COLS, { idempotency_key: input.idempotencyKey, deleted: 0 })[0];
  if (prior) {
    const row = asSite(prior);
    if (row.owner !== ctx.principal.id) raise("validation.duplicate", traceId, "A site with this idempotency key already exists.");
    return { site: siteOut(row) };
  }
  const cap = ownerCap(ctx);
  const at = ctx.now();
  const siteId = mintId("sit", at);
  const folderId = mintId("fld", ctx.now());
  const builder = builderFor(kind);
  insert(ctx.db, TABLES.site, {
    site_id: siteId,
    name: input.name,
    kind,
    owner: ctx.principal.id,
    repo_url: input.repoUrl ?? null,
    template_kit: input.templateKit ?? null,
    repo_folder_id: folderId,
    root_folder: `Deployments/${input.name}`,
    staging_url: `https://${stagingHost(siteId, ctx.space)}`,
    production_url: null,
    state: "queued",
    staging_vault_handle: null,
    staging_seal: null,
    service_principal: `svc_site_${siteId}`,
    owner_level: cap,
    builder,
    idempotency_key: input.idempotencyKey,
    settings: "{}",
    deleted: 0,
    created_at: at,
  });
  writeGrants(ctx, siteId, folderId, cap);
  ctx.emit("site.created", `site/${siteId}`, { siteId, name: input.name });
  ctx.log.info("site created", { siteId });
  return { site: siteOut(requireSite(ctx, siteId)) };
}

async function get(ctx: Ctx, input: { siteId: string }): Promise<{ site: SiteBody }> {
  return { site: siteOut(requireSite(ctx, input.siteId)) };
}

async function list(ctx: Ctx, input: { section?: "personal" | "shared" | "space"; folderId?: string; cursor?: string; limit?: number }): Promise<{ sites: SiteBody[]; next?: string; total?: number }> {
  const traceId = ctx.trace.traceId;
  if (input.section && input.section !== "personal" && input.section !== "shared" && input.section !== "space") {
    raise("validation.bad_input", traceId, "Section is personal, shared or space.");
  }
  const rows = select(ctx.db, TABLES.site, SITE_COLS, { deleted: 0 }).map(asSite).filter((row) => {
    if (input.section === "personal" && row.owner !== ctx.principal.id) return false;
    if (input.section === "shared" && row.owner === ctx.principal.id) return false;
    if (input.folderId && row.repo_folder_id !== input.folderId) return false;
    return true;
  }).sort((a, b) => b.created_at - a.created_at);
  const paged = page(rows, input.cursor, input.limit, traceId);
  const out: { sites: SiteBody[]; next?: string; total?: number } = { sites: paged.slice.map(siteOut), total: paged.total };
  if (paged.next) out.next = paged.next;
  return out;
}

// Site update handler. The SQL helper in this module is already named update.
async function updateSite(ctx: Ctx, input: { siteId: string; name?: string; settings?: Record<string, unknown> }): Promise<{ site: SiteBody }> {
  const site = requireSite(ctx, input.siteId);
  const traceId = ctx.trace.traceId;
  let name = site.name;
  if (input.name !== undefined) {
    checkName(input.name, traceId);
    name = input.name;
  }
  const settings = readSettings(site.settings);
  if (input.settings) Object.assign(settings, input.settings);
  update(ctx.db, TABLES.site, { name, root_folder: `Deployments/${name}`, settings: JSON.stringify(settings) }, { site_id: site.site_id, deleted: 0 });
  const branches: string[] = [];
  const incoming = input.settings ?? {};
  if (typeof incoming.mergedBranch === "string") branches.push(incoming.mergedBranch);
  if (Array.isArray(incoming.mergedBranches)) {
    for (const branch of incoming.mergedBranches) if (typeof branch === "string") branches.push(branch);
  }
  for (const branch of branches) await ctx.call("sites.preview_remove", { siteId: site.site_id, branch });
  return { site: siteOut(requireSite(ctx, site.site_id)) };
}

async function remove(ctx: Ctx, input: { siteId: string }): Promise<{ deleted: boolean }> {
  const site = requireSite(ctx, input.siteId);
  const platform = platformOf(ctx);
  const deployments = deploymentsOf(ctx, site.site_id);
  const domains = select(ctx.db, TABLES.domain, ["site_id", "domain", "dns_ok", "certificate"], { site_id: site.site_id });
  const hosts = new Set<string>([stagingHost(site.site_id, ctx.space)]);
  if (site.production_url) hosts.add(hostFromUrl(site.production_url));
  for (const dep of deployments) if (dep.url) hosts.add(hostFromUrl(dep.url));
  for (const domain of domains) hosts.add(str(domain, "domain"));
  update(ctx.db, TABLES.site, { deleted: 1, state: "stopped" }, { site_id: site.site_id });
  for (const host of hosts) await platform.removeRoute(host);
  const names = new Set<string>([siteContainer(site.site_id)]);
  for (const dep of deployments) names.add(dep.container_name);
  for (const name of names) await platform.stopContainer(name);
  ctx.log.info("site deleted", { siteId: site.site_id });
  return { deleted: true };
}

function insertDeployment(ctx: Ctx, row: DeploymentRow): void {
  insert(ctx.db, TABLES.deployment, {
    deployment_id: row.deployment_id,
    site_id: row.site_id,
    env: row.env,
    state: row.state,
    url: row.url,
    branch: row.branch,
    commit_sha: row.commit_sha,
    at: row.at,
    sealed: row.sealed,
    vault_handle: row.vault_handle,
    container_name: row.container_name,
    network: row.network,
    removed: row.removed,
    image: row.image,
    checks: row.checks,
    run_id: row.run_id,
  });
}

async function build(ctx: Ctx, input: { siteId: string; branch?: string }): Promise<{ runId: string; deploymentId: string }> {
  const site = requireSite(ctx, input.siteId);
  const branch = input.branch ?? "main";
  checkBranch(branch, ctx.trace.traceId);
  const runId = mintId("run", ctx.now());
  const deploymentId = mintId("dpl", ctx.now());
  const commit = commitOf(branch, ctx.now());
  const image = imageFor(site.builder);
  const platform = platformOf(ctx);
  update(ctx.db, TABLES.site, { state: "building" }, { site_id: site.site_id, deleted: 0 });
  await platform.ensureNetwork(NETWORK);
  const built = await platform.build({ siteId: site.site_id, branch, image, commit });
  const base: DeploymentRow = {
    deployment_id: deploymentId,
    site_id: site.site_id,
    env: "staging",
    state: built.ok ? "ready" : "failed",
    url: null,
    branch,
    commit_sha: built.ok ? built.commit : commit,
    at: ctx.now(),
    sealed: 0,
    vault_handle: null,
    container_name: siteContainer(site.site_id),
    network: NETWORK,
    removed: 0,
    image,
    checks: built.ok ? CHECKS_BUILT : CHECKS_FAILED,
    run_id: runId,
  };
  if (!built.ok) {
    insertDeployment(ctx, base);
    update(ctx.db, TABLES.site, { state: "failed" }, { site_id: site.site_id, deleted: 0 });
    ctx.emit("site.build_failed", `site/${site.site_id}`, { siteId: site.site_id, deploymentId, reason: built.reason.slice(0, 200) });
    ctx.log.info("site build failed", { siteId: site.site_id, deploymentId });
    return { runId, deploymentId };
  }
  await platform.startContainer({ name: base.container_name, network: NETWORK, image, siteId: site.site_id, envNames: envNames(ctx, site.site_id) });
  insertDeployment(ctx, base);
  update(ctx.db, TABLES.site, { state: "ready" }, { site_id: site.site_id, deleted: 0 });
  ctx.log.info("site build ready", { siteId: site.site_id, deploymentId });
  return { runId, deploymentId };
}

async function deploy(ctx: Ctx, input: { siteId: string; deploymentId?: string }): Promise<{ deployment: DeploymentBody }> {
  const site = requireSite(ctx, input.siteId);
  const traceId = ctx.trace.traceId;
  let dep: DeploymentRow | null = null;
  if (input.deploymentId) {
    const raw = select(ctx.db, TABLES.deployment, DEP_COLS, { deployment_id: input.deploymentId })[0];
    if (!raw) raise("validation.not_found", traceId, "That deployment does not exist.");
    dep = asDeployment(raw);
    if (dep.site_id !== site.site_id) raise("validation.not_found", traceId, "That deployment does not exist.");
  } else {
    dep = deploymentsOf(ctx, site.site_id).find((row) => row.env === "staging" && row.state === "ready" && row.removed === 0) ?? null;
    if (!dep) raise("validation.not_found", traceId, "That site has no build to deploy.");
  }
  if (dep.env !== "staging") raise("validation.bad_input", traceId, "Deploy publishes a staging build.");
  if (dep.state !== "ready") raise("validation.bad_input", traceId, "That build is not ready to deploy.");
  await refuseUnsealed(ctx, site);
  const fresh = requireSite(ctx, site.site_id);
  const handle = fresh.staging_vault_handle;
  if (!handle) raise("validation.bad_input", traceId, "Staging is behind a sealed Vault key. Set it before deploy.");
  await injectEnv(ctx, site.site_id, dep.deployment_id);
  const url = fresh.staging_url ?? `https://${stagingHost(site.site_id, ctx.space)}`;
  const at = ctx.now();
  update(ctx.db, TABLES.deployment, {
    url, state: "ready", sealed: 1, vault_handle: handle, at, checks: CHECKS_SEALED, removed: 0,
  }, { deployment_id: dep.deployment_id });
  update(ctx.db, TABLES.site, { state: "ready" }, { site_id: site.site_id, deleted: 0 });
  await republish(ctx, site.site_id);
  addLog(ctx, dep.deployment_id, `container ${dep.container_name} network ${NETWORK} deployment ${dep.deployment_id} state ready`);
  ctx.emit("site.deployed", `site/${site.site_id}`, { siteId: site.site_id, deploymentId: dep.deployment_id, env: "staging" });
  ctx.log.info("site deployed", { siteId: site.site_id, deploymentId: dep.deployment_id });
  const stored = select(ctx.db, TABLES.deployment, DEP_COLS, { deployment_id: dep.deployment_id })[0];
  if (!stored) raise("validation.not_found", traceId, "That deployment does not exist.");
  return { deployment: deploymentOut(asDeployment(stored)) };
}

async function deploymentList(ctx: Ctx, input: { siteId: string; cursor?: string; limit?: number }): Promise<{ deployments: DeploymentBody[]; next?: string; total?: number }> {
  requireSite(ctx, input.siteId);
  const rows = deploymentsOf(ctx, input.siteId).map(deploymentOut);
  const paged = page(rows, input.cursor, input.limit, ctx.trace.traceId);
  const out: { deployments: DeploymentBody[]; next?: string; total?: number } = { deployments: paged.slice, total: paged.total };
  if (paged.next) out.next = paged.next;
  return out;
}

async function previews(ctx: Ctx, input: { siteId: string }): Promise<{ previews: DeploymentBody[] }> {
  requireSite(ctx, input.siteId);
  const rows = select(ctx.db, TABLES.deployment, DEP_COLS, { site_id: input.siteId, env: "preview", removed: 0 }, { col: "at", dir: "DESC" });
  return { previews: rows.map((row) => deploymentOut(asDeployment(row))) };
}

async function previewRebuild(ctx: Ctx, input: { siteId: string; branch: string }): Promise<{ deployment: DeploymentBody }> {
  const site = requireSite(ctx, input.siteId);
  checkBranch(input.branch, ctx.trace.traceId);
  await refuseUnsealed(ctx, site);
  const fresh = requireSite(ctx, site.site_id);
  const handle = fresh.staging_vault_handle;
  if (!handle) raise("validation.bad_input", ctx.trace.traceId, "Staging is behind a sealed Vault key. Set it before deploy.");
  const existing = previewRow(ctx, site.site_id, input.branch);
  const deploymentId = existing?.deployment_id ?? mintId("dpl", ctx.now());
  const runId = mintId("run", ctx.now());
  const commit = commitOf(input.branch, ctx.now());
  const image = imageFor(fresh.builder);
  const platform = platformOf(ctx);
  await platform.ensureNetwork(NETWORK);
  const built = await platform.build({ siteId: site.site_id, branch: input.branch, image, commit });
  const url = `https://${previewHost(site.site_id, input.branch, ctx.space)}`;
  const row: DeploymentRow = {
    deployment_id: deploymentId,
    site_id: site.site_id,
    env: "preview",
    state: built.ok ? "ready" : "failed",
    url: built.ok ? url : null,
    branch: input.branch,
    commit_sha: built.ok ? built.commit : commit,
    at: ctx.now(),
    sealed: built.ok ? 1 : 0,
    vault_handle: built.ok ? handle : null,
    container_name: previewContainer(site.site_id, input.branch),
    network: NETWORK,
    removed: 0,
    image,
    checks: built.ok ? CHECKS_SEALED : CHECKS_FAILED,
    run_id: runId,
  };
  if (existing) {
    update(ctx.db, TABLES.deployment, {
      state: row.state, url: row.url, commit_sha: row.commit_sha, at: row.at, sealed: row.sealed,
      vault_handle: row.vault_handle, removed: 0, image: row.image, checks: row.checks, run_id: row.run_id,
    }, { deployment_id: deploymentId });
  } else insertDeployment(ctx, row);
  if (!built.ok) {
    ctx.log.info("preview build failed", { siteId: site.site_id, deploymentId });
    const stored = select(ctx.db, TABLES.deployment, DEP_COLS, { deployment_id: deploymentId })[0];
    if (!stored) raise("validation.not_found", ctx.trace.traceId, "That deployment does not exist.");
    return { deployment: deploymentOut(asDeployment(stored)) };
  }
  await injectEnv(ctx, site.site_id, deploymentId);
  await republish(ctx, site.site_id);
  addLog(ctx, deploymentId, `container ${row.container_name} network ${NETWORK} deployment ${deploymentId} state ready`);
  ctx.emit("site.preview_created", `site/${site.site_id}`, { siteId: site.site_id, branch: input.branch, url });
  ctx.log.info("preview created", { siteId: site.site_id, deploymentId });
  const stored = select(ctx.db, TABLES.deployment, DEP_COLS, { deployment_id: deploymentId })[0];
  if (!stored) raise("validation.not_found", ctx.trace.traceId, "That deployment does not exist.");
  return { deployment: deploymentOut(asDeployment(stored)) };
}

async function previewRemove(ctx: Ctx, input: { siteId: string; branch: string }): Promise<{ removed: boolean }> {
  const site = requireSite(ctx, input.siteId);
  checkBranch(input.branch, ctx.trace.traceId);
  const row = previewRow(ctx, site.site_id, input.branch);
  if (!row || row.removed === 1) return { removed: false };
  update(ctx.db, TABLES.deployment, { removed: 1, state: "stopped" }, { deployment_id: row.deployment_id });
  await platformOf(ctx).stopContainer(row.container_name);
  await republish(ctx, site.site_id);
  ctx.emit("site.preview_removed", `site/${site.site_id}`, { siteId: site.site_id, branch: input.branch });
  ctx.log.info("preview removed", { siteId: site.site_id, deploymentId: row.deployment_id });
  return { removed: true };
}

async function envSet(ctx: Ctx, input: { siteId: string; entries: { name: string; vaultHandle: string }[] }): Promise<{ ok: boolean }> {
  const site = requireSite(ctx, input.siteId);
  const traceId = ctx.trace.traceId;
  if (!Array.isArray(input.entries)) raise("validation.bad_input", traceId, "Environment entries are a list.");
  const seen = new Set<string>();
  for (const entry of input.entries) {
    if (!entry || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(entry.name) || entry.name.length > 80) {
      raise("validation.bad_input", traceId, "Environment names are identifiers.");
    }
    if (seen.has(entry.name)) raise("validation.bad_input", traceId, "Environment names are unique.");
    seen.add(entry.name);
    if (!isHandle(entry.vaultHandle)) raise("validation.bad_input", traceId, "That Vault handle cannot be injected.");
    useVault(ctx, entry.vaultHandle);
    try {
      await ctx.vault.fill(entry.vaultHandle, { kind: "deployment", ref: `${site.site_id}:${entry.name}` });
    } catch (error) {
      if (error instanceof VyreErr) throw error;
      raise("permission.no_grant", traceId);
    }
  }
  deleteRows(ctx.db, TABLES.env, { site_id: site.site_id });
  for (const entry of input.entries) {
    insert(ctx.db, TABLES.env, {
      site_id: site.site_id,
      name: entry.name,
      vault_handle: entry.vaultHandle,
      vault_name: entry.vaultHandle,
      injected: 1,
    });
  }
  ctx.log.info("site env set", { siteId: site.site_id, count: input.entries.length });
  return { ok: true };
}

async function envList(ctx: Ctx, input: { siteId: string }): Promise<{ entries: { name: string; vaultName: string; injected: boolean }[] }> {
  const site = requireSite(ctx, input.siteId);
  const rows = select(ctx.db, TABLES.env, ["site_id", "name", "vault_handle", "vault_name", "injected"], { site_id: site.site_id });
  return {
    entries: rows.map((row) => ({ name: str(row, "name"), vaultName: str(row, "vault_name"), injected: num(row, "injected") === 1 })),
  };
}

async function stagingPasswordSet(ctx: Ctx, input: { siteId: string; vaultHandle: string }): Promise<{ ok: boolean }> {
  const site = requireSite(ctx, input.siteId);
  if (!isHandle(input.vaultHandle)) raise("validation.bad_input", ctx.trace.traceId, "That Vault handle cannot protect staging.");
  useVault(ctx, input.vaultHandle);
  update(ctx.db, TABLES.site, {
    staging_vault_handle: input.vaultHandle,
    staging_seal: bindSeal(ctx, site.site_id, input.vaultHandle),
  }, { site_id: site.site_id, deleted: 0 });
  await republish(ctx, site.site_id);
  ctx.log.info("staging seal set", { siteId: site.site_id });
  return { ok: true };
}

async function serviceIdentity(ctx: Ctx, input: { siteId: string }): Promise<{ principal: string; grants: { resource: string; level: string }[] }> {
  const site = requireSite(ctx, input.siteId);
  const rows = select(ctx.db, TABLES.grant, ["site_id", "resource", "level"], { site_id: site.site_id });
  return {
    principal: site.service_principal,
    grants: rows.map((row) => ({ resource: str(row, "resource"), level: str(row, "level") })),
  };
}

async function logs(ctx: Ctx, input: { siteId: string; deploymentId?: string; tail?: number }): Promise<{ lines: string[] }> {
  const site = requireSite(ctx, input.siteId);
  let deploymentId = input.deploymentId;
  if (!deploymentId) {
    const top = deploymentsOf(ctx, site.site_id)[0];
    if (!top) return { lines: [] };
    deploymentId = top.deployment_id;
  }
  const raw = select(ctx.db, TABLES.deployment, DEP_COLS, { deployment_id: deploymentId })[0];
  if (!raw || asDeployment(raw).site_id !== site.site_id) raise("validation.not_found", ctx.trace.traceId, "That deployment does not exist.");
  let lines = select(ctx.db, TABLES.log, ["deployment_id", "seq", "line"], { deployment_id: deploymentId }, { col: "seq", dir: "ASC" }).map((row) => str(row, "line"));
  if (input.tail !== undefined) {
    if (!Number.isInteger(input.tail) || input.tail < 1) raise("validation.bad_input", ctx.trace.traceId, "Tail is a positive count.");
    lines = lines.slice(-input.tail);
  }
  return { lines };
}

export const deployHandlers = {
  "sites.create": create,
  "sites.get": get,
  "sites.list": list,
  "sites.update": updateSite,
  "sites.delete": remove,
  "sites.build": build,
  "sites.deploy": deploy,
  "sites.deployments": deploymentList,
  "sites.previews": previews,
  "sites.preview_rebuild": previewRebuild,
  "sites.preview_remove": previewRemove,
  "sites.env_set": envSet,
  "sites.env_list": envList,
  "sites.staging_password_set": stagingPasswordSet,
  "sites.service_identity": serviceIdentity,
  "sites.logs": logs,
};
