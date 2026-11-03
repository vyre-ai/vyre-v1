// Sites Vyre builds and runs (owner, 3 Nov: "deploy it on here instead of Railway"). A site with a source is built into an image and run as its own container on a server of the Space
// (handlers/runner.ts), and its address points at that container. Each deploy is a row of sites_deployment (env production): it is queued, built, started, checked, and only then does
// the address switch to it; until then the last good build keeps serving, and a failed one leaves it serving. Rollback starts an earlier build's image again.
//   env       sites_env: a name and a Vault handle. Values are filled from the Vault at deploy time, into this deploy only, and reach the container's environment and nothing else
//   addons    a Postgres or Redis of the site's own on its network, its address given as DATABASE_URL or REDIS_URL; the password is sealed in sites_addon
//   failures  every one ends in plain words and one fix (fix: set_env, add_postgres, add_redis, retry, set_start, set_port, open_logs, connect_repo, free_space, more_memory)
// The work after the call answers (fetch, build, start) runs here in the background on the module's own db handle; the deploy row is how the app, an agent and the build log follow it.
// @reads ../migrations/0004_deploy.sql
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import { touchActivity } from "../projections.ts";
import { fail, flag, hexOf, isNull, many, mustSite, nid, num, one, optBool, optStr, rec, reqStr, str } from "./deploy.ts";
import { sitePlan } from "./plan.ts";
import type { SitePlan } from "./plan.ts";
import { addonHost, DEFAULT_LIMITS, MIN_FREE_MB } from "./runner.ts";
import type { AddonKind, Limits, Runner } from "./runner.ts";
import { cleanBranch, fetchSource, remoteHead, repoUrl, SourceError } from "./source.ts";
import type { SourceSpec } from "./source.ts";
import { routesHost, siteRunner } from "./route.ts";

type Row = Record<string, unknown>;
type Db = Ctx["db"];
export type Fix = "set_env" | "add_postgres" | "add_redis" | "retry" | "set_start" | "set_port" | "open_logs" | "connect_repo" | "free_space" | "more_memory";

const LOG_KEEP = 3000;
const READY_MS = 120_000;
const KEEP_IMAGES = 5;
const WAIT_MAX_MS = 20 * 60_000;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const HANDLE = /^#[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)?$/;
const RESERVED_ENV = new Set(["PORT", "HOST", "HOSTNAME", "PATH", "HOME"]);

const runner = (): Runner | null => siteRunner();

/** Why this Space cannot build and run apps, in a sentence, or null when it can. */
export function deployNeed(): string | null {
  if (!siteRunner()) return "This server has no sites runner, so Vyre cannot build and run apps here yet. Updating Vyre Server adds it.";
  return null;
}

// ---- shapes

export function parseJson<T>(text: unknown, fallback: T): T {
  if (typeof text !== "string" || text === "") return fallback;
  try { return JSON.parse(text) as T; } catch { return fallback; }
}

export function depRow(r: Row, currentId: string | null): Record<string, unknown> {
  // a deploy this process is not running, still marked as running, was cut off by a restart of the server: it says so, with the fix
  const orphan = (r.state === "queued" || r.state === "building") && !done.has(str(r.id));
  if (orphan) return { ...depRow({ ...r, state: "failed", problem: "The server restarted during this deploy. Deploy again.", fix: "retry" }, currentId) };
  return {
    deploymentId: str(r.id), siteId: str(r.site_id), env: str(r.env), state: str(r.state), at: num(r.at),
    ...(isNull(r.url) ? {} : { url: str(r.url) }), ...(isNull(r.branch) ? {} : { branch: str(r.branch) }), ...(isNull(r.commit_sha) ? {} : { commit: str(r.commit_sha) }),
    by: str(r.created_by), ...(isNull(r.note) ? {} : { note: str(r.note) }), ...(isNull(r.problem) ? {} : { problem: str(r.problem) }), ...(isNull(r.fix) ? {} : { fix: str(r.fix) }),
    current: currentId !== null && r.id === currentId, ...(isNull(r.finished_at) ? {} : { finishedAt: num(r.finished_at) }),
  };
}

export function sourceOf(r: Row): SourceSpec | null { return parseJson<SourceSpec | null>(r.source, null); }
export function limitsOf(r: Row): Limits { return { ...DEFAULT_LIMITS, ...parseJson<Partial<Limits>>(r.limits, {}) }; }

/** Check a source given by a person or agent; tokens only as Vault handles. */
export function cleanSource(ctx: Ctx, raw: unknown): SourceSpec {
  const o = rec(ctx, raw);
  const s: SourceSpec = {};
  for (const k of ["repo", "branch", "tokenHandle", "folderId", "fileId", "path", "root"] as const) {
    const v = optStr(ctx, o, k);
    if (v !== undefined && v.trim() !== "") s[k] = v.trim();
  }
  const given = [s.repo, s.folderId, s.fileId, s.path].filter(Boolean).length;
  if (given !== 1) fail(ctx, "validation.bad_input", "Give one source: a GitHub repo, a folder or zip in Files, or a folder on this computer.", { field: "source" });
  try {
    if (s.repo) repoUrl(s.repo);
    if (s.branch) cleanBranch(s.branch);
  } catch (e) { fail(ctx, "validation.bad_input", e instanceof Error ? e.message : "That repo cannot be used.", { field: "source.repo" }); }
  if (s.tokenHandle && !HANDLE.test(s.tokenHandle)) fail(ctx, "validation.bad_input", "A Vault key is written as #Name.", { field: "source.tokenHandle" });
  if (s.root && (s.root.includes("..") || s.root.startsWith("/"))) fail(ctx, "validation.bad_input", "The app folder is a path inside the project, like apps/web.", { field: "source.root" });
  if (s.folderId && ctx.authorize({ perm: null, level: "view" }, { type: "folder", id: s.folderId }).effect !== "allow") fail(ctx, "permission.no_grant", "You cannot read that folder.", { folderId: s.folderId });
  if (!s.repo) delete s.branch;
  return s;
}

export function cleanLimits(ctx: Ctx, raw: unknown): Limits {
  const o = rec(ctx, raw);
  const cpus = typeof o.cpus === "number" ? o.cpus : DEFAULT_LIMITS.cpus;
  const memoryMb = typeof o.memoryMb === "number" ? Math.trunc(o.memoryMb) : DEFAULT_LIMITS.memoryMb;
  const diskMb = typeof o.diskMb === "number" ? Math.trunc(o.diskMb) : DEFAULT_LIMITS.diskMb;
  if (!(cpus >= 0.1 && cpus <= 16)) fail(ctx, "validation.bad_input", "CPUs are between 0.1 and 16.", { field: "limits.cpus" });
  if (!(memoryMb >= 128 && memoryMb <= 65536)) fail(ctx, "validation.bad_input", "Memory is between 128 MB and 64 GB.", { field: "limits.memoryMb" });
  return { cpus, memoryMb, ...(diskMb !== undefined ? { diskMb } : {}) };
}

// ---- the log of a deploy

/** Lines are kept in memory and written every few hundred milliseconds, so a build that prints fast does not write a row per line, and the app sees them within a second. */
class DeployLog {
  private lines: string[];
  private dirty = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private db: Db;
  private id: string;
  constructor(db: Db, id: string, start: string[] = []) {
    this.db = db;
    this.id = id;
    this.lines = start;
    this.timer = setInterval(() => this.flush(), 400);
    this.timer.unref?.();
  }
  add(line: string): void {
    for (const l of line.split("\n")) {
      const t = l.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, "").replace(/\r/g, "").trimEnd();
      if (t === "") continue;
      this.lines.push(t.length > 600 ? `${t.slice(0, 600)}...` : t);
    }
    if (this.lines.length > LOG_KEEP) this.lines = [`... ${this.lines.length - LOG_KEEP} earlier lines left out`, ...this.lines.slice(-LOG_KEEP)];
    this.dirty = true;
  }
  tail(n: number): string[] { return this.lines.slice(-n); }
  flush(): void {
    if (!this.dirty) return;
    this.dirty = false;
    try { this.db.run("UPDATE sites_deployment SET log = ?, updated_at = ? WHERE id = ?", JSON.stringify(this.lines), Date.now(), this.id); } catch { /* the Space is stopping */ }
  }
  close(): void { if (this.timer) clearInterval(this.timer); this.timer = null; this.flush(); }
}

// ---- reading what went wrong

/** Plain words and one fix for a build or start that failed, from what it printed. */
export function diagnose(lines: readonly string[], a: { stage: "source" | "build" | "start"; plan?: SitePlan | null; port?: number; oom?: boolean; memoryMb?: number; hasPostgres?: boolean; hasRedis?: boolean; envSet?: ReadonlySet<string> }): { problem: string; fix: Fix } {
  const text = lines.slice(-200).join("\n");
  if (a.oom || /JavaScript heap out of memory|Killed\s*$|exit code: 137|returned a non-zero code: 137/im.test(text)) {
    return a.stage === "build"
      ? { problem: "The build ran out of memory. It gets 3 GB; a smaller build step or a server with more memory fixes it.", fix: "open_logs" }
      : { problem: `It ran out of memory (${a.memoryMb ?? DEFAULT_LIMITS.memoryMb} MB). Give it more memory and deploy again.`, fix: "more_memory" };
  }
  if (/no space left on device/i.test(text)) return { problem: "The server's disk is full. Remove old sites or builds, then deploy again.", fix: "free_space" };
  if (a.stage === "start") {
    if (/ECONNREFUSED[^\n]*(:5432|postgres)|could not connect to server|connection to server at .*5432|password authentication failed|database .* does not exist|getaddrinfo [A-Z_]+ postgres|P1001|DATABASE_URL/i.test(text) && !a.hasPostgres) {
      return { problem: "It needs a Postgres database and has none. Add one: it gets DATABASE_URL.", fix: "add_postgres" };
    }
    if (/ECONNREFUSED[^\n]*:6379|Redis connection|getaddrinfo [A-Z_]+ redis|REDIS_URL/i.test(text) && !a.hasRedis) return { problem: "It needs Redis and has none. Add one: it gets REDIS_URL.", fix: "add_redis" };
    const missing = /(?:missing|required|not set|undefined|is not defined)[^\n]{0,40}\b([A-Z][A-Z0-9_]{2,})\b|\b([A-Z][A-Z0-9_]{2,})\b[^\n]{0,30}(?:is missing|is required|is not set|must be set|not found in env)/.exec(text);
    const name = missing?.[1] ?? missing?.[2];
    if (name && !a.envSet?.has(name) && !/^(PORT|HOST|NODE_ENV|PATH)$/.test(name)) return { problem: `It stopped because ${name} is not set. Add it from the Vault.`, fix: "set_env" };
    if (/Missing script: "?start"?|missing script: start/i.test(text)) return { problem: "There is no start script. Add \"start\" to package.json, a Procfile web line, or a start command.", fix: "set_start" };
    if (/Cannot find module|ModuleNotFoundError|No module named/i.test(text)) return { problem: `It could not find a module it imports: ${(/(Cannot find module '[^']+'|No module named '?[\w.]+'?)/.exec(text)?.[1] ?? "see the log")}. Add it to the dependencies.`, fix: "open_logs" };
    if (/EADDRINUSE|address already in use/i.test(text)) return { problem: "Two things in it want the same port. Start only the web server.", fix: "set_start" };
    if (a.port !== undefined && !/error/i.test(text.split("\n").slice(-5).join("\n"))) return { problem: `It started, but nothing answers on port ${a.port}. Make the app listen on the PORT env var, on 0.0.0.0.`, fix: "set_port" };
    return { problem: `It stopped right after starting: ${lastError(lines) ?? "the log says why"}.`, fix: "open_logs" };
  }
  if (a.stage === "build") {
    if (/npm ERR! (code )?ERESOLVE|Could not resolve dependency/i.test(text)) return { problem: "npm could not settle the dependencies. Commit a package-lock.json that installs, or fix the versions.", fix: "open_logs" };
    if (/npm ci.*can only install|package-lock\.json.*(not in sync|out of sync)/i.test(text)) return { problem: "package-lock.json does not match package.json. Run npm install and commit the lock file.", fix: "open_logs" };
    if (/Missing script: "?build"?/i.test(text)) return { problem: "The build step names a script package.json does not have.", fix: "set_start" };
    if (/Failed to compile|Type error:|error TS\d+/i.test(text)) return { problem: `The app did not compile: ${lastError(lines) ?? "see the log"}.`, fix: "open_logs" };
    if (/pull access denied|manifest unknown|not found: manifest/i.test(text)) return { problem: "The Dockerfile starts FROM an image this server cannot fetch. Check the image name.", fix: "open_logs" };
    return { problem: `The build failed: ${lastError(lines) ?? "the last lines of the log say why"}.`, fix: "open_logs" };
  }
  return { problem: lastError(lines) ?? "The code could not be fetched.", fix: "connect_repo" };
}

function lastError(lines: readonly string[]): string | null {
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 60); i--) {
    const l = (lines[i] ?? "").trim();
    if (/error|failed|cannot|could not|not found|exception|denied/i.test(l) && l.length > 8) return l.replace(/^(npm ERR!|ERROR:?|error:?)\s*/i, "").slice(0, 220);
  }
  return null;
}

// ---- env, tokens and addons, filled while the call is still the caller's

async function filled(ctx: Ctx, handle: string, ref: string): Promise<string> {
  const h = routesHost();
  if (!h?.take) fail(ctx, "validation.precondition_failed", "This server cannot fill values from the Vault into a site.");
  try { await ctx.vault.fill(handle, { kind: "container_env", ref }); } catch (e) {
    fail(ctx, "permission.no_grant", `You cannot use the Vault key ${handle}, or it is empty. Ask for access or pick another.`, { handle, error: e instanceof Error ? e.message.slice(0, 120) : "" });
  }
  const v = h.take(ref);
  if (v === undefined) fail(ctx, "validation.precondition_failed", `The Vault key ${handle} has no value.`, { handle });
  return v;
}

async function secretOf(ctx: Ctx, r: Row): Promise<string> {
  const sealed = parseJson<{ keyId: string; nonce: string; bytes: string } | null>(r.secret, null);
  if (!sealed) return "";
  return new TextDecoder().decode(ctx.seal.unseal(sealed));
}

async function addonEnv(ctx: Ctx, siteId: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const a of many(ctx, "SELECT * FROM sites_addon WHERE site_id = ?", siteId)) {
    const pass = encodeURIComponent(await secretOf(ctx, a));
    const host = addonHost(siteId, str(a.kind) as AddonKind);
    if (a.kind === "postgres") Object.assign(out, { DATABASE_URL: `postgres://app:${pass}@${host}:5432/app`, PGHOST: host, PGPORT: "5432", PGUSER: "app", PGPASSWORD: decodeURIComponent(pass), PGDATABASE: "app" });
    if (a.kind === "redis") out.REDIS_URL = `redis://default:${pass}@${host}:6379`;
  }
  return out;
}

async function envOf(ctx: Ctx, siteId: string, depId: string): Promise<Record<string, string>> {
  const out = await addonEnv(ctx, siteId);
  for (const e of many(ctx, "SELECT * FROM sites_env WHERE site_id = ?", siteId)) out[str(e.name)] = await filled(ctx, str(e.vault_handle), `${depId}:${str(e.name)}`);
  return out;
}

// ---- the background part of a deploy

const queue: Array<() => Promise<void>> = [];
let building = false;
/** One build at a time on a server: two Next.js builds at once can take a small server's memory. */
function enqueue(job: () => Promise<void>): Promise<void> {
  return new Promise((resolve) => {
    queue.push(async () => { try { await job(); } finally { resolve(); } });
    if (!building) void drain();
  });
}
async function drain(): Promise<void> {
  building = true;
  while (queue.length) await (queue.shift() as () => Promise<void>)();
  building = false;
}
const done = new Map<string, Promise<void>>();

interface Job {
  db: Db; site: Row; depId: string; source: SourceSpec; env: Record<string, string>; token: string | null; limits: Limits;
  call(cap: string, input: unknown): Promise<unknown>; contained: boolean; by: string; publicNeedsPromote: boolean;
}

function finish(db: Db, depId: string, state: "ready" | "failed", fields: { problem?: string; fix?: Fix; note?: string }): void {
  const now = Date.now();
  db.run("UPDATE sites_deployment SET state = ?, problem = ?, fix = ?, note = COALESCE(?, note), finished_at = ?, updated_at = ? WHERE id = ?", state, fields.problem ?? null, fields.fix ?? null, fields.note ?? null, now, now, depId);
}

/** Wait until the new container answers on its port; a container that stops, or never answers, is a failure with its log. */
async function waitReady(r: Runner, containerId: string, port: number, health: string, log: DeployLog): Promise<{ ok: true } | { ok: false; oom: boolean; lines: string[] }> {
  const h = routesHost();
  const until = Date.now() + READY_MS;
  let seen = 0;
  while (Date.now() < until) {
    const st = await r.state(containerId);
    const lines = await r.logs(containerId, 300);
    for (const l of lines.slice(seen)) log.add(l);
    seen = lines.length;
    if (!st || (!st.running && st.exitCode !== undefined && st.exitCode !== 0) || st.oom) return { ok: false, oom: st?.oom === true, lines };
    if (st.running && h) {
      const p = await h.probe({ container: containerId, port }, health);
      if (p.answering) return { ok: true };
    }
    await new Promise((res) => setTimeout(res, 700));
  }
  return { ok: false, oom: false, lines: await r.logs(containerId, 300) };
}

async function runJob(j: Job): Promise<void> {
  const r = runner();
  const siteId = str(j.site.id);
  const log = new DeployLog(j.db, j.depId);
  const say = (line: string): void => log.add(`==> ${line}`);
  let fetched: Awaited<ReturnType<typeof fetchSource>> | null = null;
  let plan: SitePlan | null = null;
  try {
    if (!r) { finish(j.db, j.depId, "failed", { problem: deployNeed() ?? "No server can run it.", fix: "retry" }); return; }
    j.db.run("UPDATE sites_deployment SET state = ?, updated_at = ? WHERE id = ?", "building", Date.now(), j.depId);
    const free = await r.freeMb();
    if (free !== null && free < MIN_FREE_MB) { say(`Only ${free} MB free on the server's disk.`); finish(j.db, j.depId, "failed", { problem: `The server has ${free} MB of disk left, and a build needs ${MIN_FREE_MB} MB. Remove old sites or builds first.`, fix: "free_space" }); return; }
    say(j.source.repo ? `Getting ${j.source.repo}${j.source.branch ? ` (${j.source.branch})` : ""}` : j.source.fileId ? "Unpacking the upload" : j.source.folderId ? "Reading the folder from Files" : `Copying ${j.source.path}`);
    try {
      fetched = await fetchSource(j.source, { call: j.call, token: async () => j.token, contained: j.contained, ...(routesHost()?.tmp ? { tmp: routesHost()!.tmp! } : {}) });
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      log.add(why);
      finish(j.db, j.depId, "failed", { problem: why, fix: e instanceof SourceError ? e.fix : "retry" });
      return;
    }
    if (fetched.commit) { say(`Commit ${fetched.commit.slice(0, 7)}${fetched.message ? `: ${fetched.message}` : ""}`); j.db.run("UPDATE sites_deployment SET commit_sha = ?, message = ?, branch = ? WHERE id = ?", fetched.commit, fetched.message ?? null, fetched.branch ?? j.source.branch ?? null, j.depId); }
    try { plan = await sitePlan(fetched.dir); } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      log.add(why);
      finish(j.db, j.depId, "failed", { problem: why, fix: "set_start" });
      return;
    }
    say(plan.note);
    const hasPg = "DATABASE_URL" in j.env, hasRedis = "REDIS_URL" in j.env;
    if (plan.needs.includes("postgres") && !hasPg) say("It looks for a Postgres database (DATABASE_URL). Add one in the site's Database section if it needs it.");
    if (plan.needs.includes("redis") && !hasRedis) say("It looks for Redis (REDIS_URL). Add one if it needs it.");
    const missing = plan.env.filter((n) => !(n in j.env) && !RESERVED_ENV.has(n) && n !== "NODE_ENV");
    if (missing.length) say(`Its example env names ${missing.slice(0, 12).join(", ")}${missing.length > 12 ? " and more" : ""}, which ${missing.length === 1 ? "is" : "are"} not set.`);
    j.db.run("UPDATE sites_deployment SET note = ?, port = ?, plan = ? WHERE id = ?", plan.note, plan.port, JSON.stringify({ kind: plan.kind, build: plan.build, start: plan.start, port: plan.port, needs: plan.needs, env: plan.env, from: plan.from }), j.depId);
    say("Building");
    const built = await r.build({ siteId, deploymentId: j.depId, dir: fetched.dir, plan, onLine: (l) => log.add(l) });
    fetched.cleanup(); fetched = null;
    if (!built.ok) {
      log.add(built.reason);
      const d = diagnose(log.tail(300), { stage: "build", plan });
      finish(j.db, j.depId, "failed", d);
      return;
    }
    j.db.run("UPDATE sites_deployment SET image = ? WHERE id = ?", built.image, j.depId);
    await keepNetwork(j.db, r, siteId);
    say(`Starting it with ${j.limits.cpus} CPU and ${j.limits.memoryMb} MB`);
    const started = await r.run({ siteId, deploymentId: j.depId, image: built.image, port: plan.port, env: j.env, limits: j.limits });
    if (started.note) say(started.note);
    j.db.run("UPDATE sites_deployment SET container_id = ? WHERE id = ?", started.containerId, j.depId);
    const ready = await waitReady(r, started.containerId, plan.port, plan.health, log);
    if (!ready.ok) {
      const d = diagnose(ready.lines, { stage: "start", plan, port: plan.port, oom: ready.oom, memoryMb: j.limits.memoryMb, hasPostgres: hasPg, hasRedis, envSet: new Set(Object.keys(j.env)) });
      await r.remove(started.containerId).catch(() => undefined);
      j.db.run("UPDATE sites_deployment SET container_id = NULL WHERE id = ?", j.depId);
      log.add(d.problem);
      finish(j.db, j.depId, "failed", d);
      return;
    }
    await switchTo(j.db, r, siteId, j.depId, started.containerId, plan.port, j.by, j.publicNeedsPromote);
    say("Live");
    finish(j.db, j.depId, "ready", {});
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    log.add(why);
    finish(j.db, j.depId, "failed", { problem: `The deploy stopped: ${why.slice(0, 200)}`, fix: "retry" });
  } finally {
    fetched?.cleanup();
    log.close();
  }
}

/** The address now serves the new container; the one before is removed, its image kept for a rollback, and images older than the last few are removed. */
async function switchTo(db: Db, r: Runner, siteId: string, depId: string, containerId: string, port: number, by: string, publicNeedsPromote: boolean): Promise<void> {
  const site = (db.all("SELECT * FROM sites_site WHERE id = ?", siteId) as Row[])[0];
  if (!site) return;
  const before = isNull(site.container_id) ? null : str(site.container_id);
  const now = Date.now();
  // a public site goes on the internet only through sites.promote (the Gate); every other access is live at once
  const live = str(site.access) === "public" && publicNeedsPromote && !flag(site.live) ? 0 : 1;
  db.run("UPDATE sites_site SET container_id = ?, port = ?, computer_id = NULL, target_folder = NULL, current_deployment = ?, deployed_by = ?, live = ?, state = ?, updated_at = ? WHERE id = ?", containerId, port, depId, by, live, live ? "ready" : "stopped", now, siteId);
  db.run("UPDATE sites_deployment SET url = NULL WHERE site_id = ? AND id != ?", siteId, depId);
  touchActivity(db as never, siteId, "site.deployed", now);
  if (before && before !== containerId) {
    await r.remove(before).catch(() => undefined);
    db.run("UPDATE sites_deployment SET container_id = NULL WHERE site_id = ? AND container_id = ?", siteId, before);
  }
  const images = (db.all("SELECT id, image FROM sites_deployment WHERE site_id = ? AND image IS NOT NULL ORDER BY at DESC", siteId) as Row[]);
  for (const old of images.slice(KEEP_IMAGES)) {
    await r.removeImage(str(old.image)).catch(() => undefined);
    db.run("UPDATE sites_deployment SET image = NULL WHERE id = ?", old.id);
  }
  await routesHost()?.hostRoute?.(siteId, true).catch(() => undefined);
}

/** The site's own network, made when missing; its subnet is kept so the gateway refuses connections that come from it (sites never reach vyred). */
async function keepNetwork(db: Db, r: Runner, siteId: string): Promise<void> {
  const net = await r.network(siteId);
  const row = (db.all("SELECT settings FROM sites_site WHERE id = ?", siteId) as Row[])[0];
  const settings = parseJson<Record<string, unknown>>(row?.settings, {});
  if ((settings["network"] as { subnet?: string } | undefined)?.subnet === net.subnet) return;
  db.run("UPDATE sites_site SET settings = ? WHERE id = ?", JSON.stringify({ ...settings, network: net }), siteId);
}

/** Every site network's subnet, for the gateway: a connection that arrives on one of these addresses came from a site, and is closed. */
export function siteSubnets(ctx: Pick<Ctx, "db">): string[] {
  const out: string[] = [];
  for (const r of ctx.db.all("SELECT settings FROM sites_site WHERE source IS NOT NULL") as Row[]) {
    const subnet = (parseJson<Record<string, unknown>>(r.settings, {})["network"] as { subnet?: string } | undefined)?.subnet;
    if (typeof subnet === "string" && subnet) out.push(subnet);
  }
  return out;
}

// ---- capabilities

async function sitesDeploy(ctx: Ctx, input: unknown): Promise<{ deployment: unknown }> {
  const o = rec(ctx, input);
  let site = mustSite(ctx, reqStr(ctx, o, "siteId"));
  if (site.kind === "artifact") fail(ctx, "validation.bad_input", "An artifact is published with artifact_publish, not deployed.");
  // a new source is kept once the deploy is going ahead: every refusal below comes before the write (ruling 90)
  const newSource = o.source !== undefined && o.source !== null ? JSON.stringify(cleanSource(ctx, o.source)) : null;
  if (newSource !== null) site = { ...site, source: newSource };
  const source = sourceOf(site);
  if (!source) fail(ctx, "validation.precondition_failed", "Give the site its source first: a GitHub repo, a folder or zip in Files, or a folder on this computer.");
  const need = deployNeed();
  if (need) fail(ctx, "validation.precondition_failed", need);
  const siteId = str(site.id);
  const current = isNull(site.current_deployment) ? null : str(site.current_deployment);
  const token = source.tokenHandle ? await filled(ctx, source.tokenHandle, `${siteId}:token:${ctx.now()}`) : null;
  if (optBool(ctx, o, "onlyIfChanged") === true && source.repo) {
    const last = one(ctx, "SELECT * FROM sites_deployment WHERE site_id = ? AND env = ? ORDER BY at DESC", siteId, "production");
    // a push redeploys a site that was deployed; the first deploy is someone's own press
    if (!last) fail(ctx, "validation.precondition_failed", "It has not been deployed yet.");
    const head = await remoteHead(source.repo, source.branch, token);
    if (last && head && (last.commit_sha === head || (last.state !== "ready" && last.state !== "failed"))) return { deployment: depRow(last, current) };
    if (!head) fail(ctx, "validation.precondition_failed", "The repo could not be read just now.");
  }
  if (newSource !== null) { ctx.db.run("UPDATE sites_site SET source = ?, updated_at = ? WHERE id = ?", newSource, ctx.now(), siteId); site = mustSite(ctx, siteId); }
  const busy = one(ctx, "SELECT * FROM sites_deployment WHERE site_id = ? AND env = ? AND state IN ('queued', 'building')", siteId, "production");
  if (busy && done.has(str(busy.id))) {
    // one deploy at a time per site: a second ask joins the one running, and waits for it when asked to
    if (optBool(ctx, o, "wait") === true) await Promise.race([done.get(str(busy.id)), new Promise((res) => setTimeout(res, WAIT_MAX_MS).unref?.())]);
    const now_ = mustSite(ctx, siteId);
    return { deployment: depRow(one(ctx, "SELECT * FROM sites_deployment WHERE id = ?", busy.id) as Row, isNull(now_.current_deployment) ? null : str(now_.current_deployment)) };
  }
  const depId = nid(ctx, "dpl");
  const now = ctx.now();
  const by = ctx.actingFor ?? ctx.principal.id;
  ctx.db.run(
    "INSERT INTO sites_deployment (id, site_id, env, state, url, branch, commit_sha, image, container_id, host, upstream, pr_number, log, created_by, at, updated_at, removed_at, merge_pending) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    depId, siteId, "production", "queued", null, source.branch ?? null, null, null, null, null, null, null, "[]", by, now, now, null, 0,
  );
  // values are filled now, while this is the caller's own call: the Vault checks their access to each key
  const env = await envOf(ctx, siteId, depId);
  const h = routesHost();
  const job: Job = {
    db: ctx.db, site, depId, source, env, token, limits: limitsOf(site), by, contained: h?.contained === true,
    call: (cap, inp) => ctx.call(cap as never, inp), publicNeedsPromote: ctx.principal.kind !== "person",
  };
  const p = enqueue(() => runJob(job)).finally(() => done.delete(depId));
  done.set(depId, p);
  touchActivity(ctx.db, siteId, "site.deployed", now);
  if (optBool(ctx, o, "wait") === true) await Promise.race([p, new Promise((res) => setTimeout(res, WAIT_MAX_MS).unref?.())]);
  const row = one(ctx, "SELECT * FROM sites_deployment WHERE id = ?", depId) as Row;
  return { deployment: depRow(row, isNull(mustSite(ctx, siteId).current_deployment) ? null : str(mustSite(ctx, siteId).current_deployment)) };
}

async function sitesDeployments(ctx: Ctx, input: unknown): Promise<{ deployments: unknown[]; next?: string; total: number }> {
  const o = rec(ctx, input);
  const site = mustSite(ctx, reqStr(ctx, o, "siteId"));
  const limit = Math.min(typeof o.limit === "number" ? o.limit : 50, 500);
  const offset = typeof o.cursor === "string" && /^[0-9]{1,9}$/.test(o.cursor) ? Number(o.cursor) : 0;
  const rows = many(ctx, "SELECT * FROM sites_deployment WHERE site_id = ? AND env = ?", site.id, "production").sort((a, b) => num(b.at) - num(a.at) || str(b.id).localeCompare(str(a.id)));
  const current = isNull(site.current_deployment) ? null : str(site.current_deployment);
  const out: { deployments: unknown[]; next?: string; total: number } = { deployments: rows.slice(offset, offset + limit).map((r) => depRow(r, current)), total: rows.length };
  if (offset + limit < rows.length) out.next = String(offset + limit);
  return out;
}

async function sitesRollback(ctx: Ctx, input: unknown): Promise<{ deployment: unknown }> {
  const o = rec(ctx, input);
  const site = mustSite(ctx, reqStr(ctx, o, "siteId"));
  const r = runner();
  if (!r) fail(ctx, "validation.precondition_failed", deployNeed() ?? "No server can run it.");
  const siteId = str(site.id);
  const current = isNull(site.current_deployment) ? null : str(site.current_deployment);
  const wanted = optStr(ctx, o, "toDeploymentId");
  const done_ = many(ctx, "SELECT * FROM sites_deployment WHERE site_id = ? AND env = ? AND image IS NOT NULL AND finished_at IS NOT NULL", siteId, "production").sort((a, b) => num(b.at) - num(a.at));
  const target = wanted !== undefined ? done_.find((d) => d.id === wanted) : done_.find((d) => d.id !== current && d.state === "ready" && num(d.at) < num(done_.find((x) => x.id === current)?.at ?? Number.MAX_SAFE_INTEGER));
  if (!target) fail(ctx, "validation.precondition_failed", wanted ? "That build is no longer kept on the server. Deploy its commit again instead." : "There is no earlier build to go back to.");
  if (target.id === current) return { deployment: depRow(target, current) };
  if (!(await r.imageExists(str(target.image)))) fail(ctx, "validation.precondition_failed", "That build's image is gone from the server. Deploy its commit again instead.");
  const plan = parseJson<{ port?: number }>(target.plan, {});
  const port = num(target.port) || plan.port || 3000;
  const env = await envOf(ctx, siteId, str(target.id));
  const started = await r.run({ siteId, deploymentId: `${str(target.id)}r${ctx.now().toString(36)}`, image: str(target.image), port, env, limits: limitsOf(site) });
  const log = new DeployLog(ctx.db, str(target.id), parseJson<string[]>(target.log, []));
  log.add(`==> Rolling back to this build (${ctx.now()})`);
  const ready = await waitReady(r, started.containerId, port, "/", log);
  log.close();
  if (!ready.ok) {
    await r.remove(started.containerId).catch(() => undefined);
    const d = diagnose(ready.lines, { stage: "start", port, oom: ready.oom, memoryMb: limitsOf(site).memoryMb });
    fail(ctx, "validation.precondition_failed", `That build did not come back up: ${d.problem}`);
  }
  await switchTo(ctx.db, r, siteId, str(target.id), started.containerId, port, ctx.actingFor ?? ctx.principal.id, ctx.principal.kind !== "person");
  ctx.db.run("UPDATE sites_deployment SET container_id = ?, state = ? WHERE id = ?", started.containerId, "ready", target.id);
  ctx.emit("site.rolled_back", `site/${siteId}`, { siteId, toDeploymentId: str(target.id) });
  return { deployment: depRow(one(ctx, "SELECT * FROM sites_deployment WHERE id = ?", target.id) as Row, str(target.id)) };
}

async function sitesEnvSet(ctx: Ctx, input: unknown): Promise<{ ok: boolean }> {
  const o = rec(ctx, input);
  const site = mustSite(ctx, reqStr(ctx, o, "siteId"));
  if (!Array.isArray(o.entries)) fail(ctx, "validation.bad_input", "The entries are not valid.", { field: "entries" });
  if (o.entries.length > 200) fail(ctx, "validation.too_large", "A site takes at most 200 env vars.", { field: "entries" });
  const seen = new Set<string>();
  const next: { name: string; handle: string }[] = [];
  for (const e of o.entries) {
    const row = rec(ctx, e);
    const name = reqStr(ctx, row, "name").trim();
    const handle = reqStr(ctx, row, "vaultHandle").trim();
    if (!ENV_NAME.test(name)) fail(ctx, "validation.bad_input", "An env var name uses letters, digits and underscores, and does not start with a digit.", { field: "entries.name", name });
    if (RESERVED_ENV.has(name)) fail(ctx, "validation.bad_input", `${name} is set by Vyre.`, { field: "entries.name", name });
    if (!HANDLE.test(handle)) fail(ctx, "validation.bad_input", "A Vault key is written as #Name or #Name.field.", { field: "entries.vaultHandle", name });
    if (seen.has(name)) fail(ctx, "validation.duplicate", `${name} is listed twice.`, { name });
    seen.add(name);
    next.push({ name, handle });
  }
  // the caller must be able to use each key now, or a deploy would fail later for a reason they cannot see
  for (const e of next) await filled(ctx, e.handle, `check:${str(site.id)}:${e.name}:${ctx.now()}`);
  ctx.db.run("DELETE FROM sites_env WHERE site_id = ?", site.id);
  for (const e of next) ctx.db.run("INSERT INTO sites_env (site_id, name, vault_handle, injected) VALUES (?, ?, ?, ?)", site.id, e.name, e.handle, 0);
  ctx.db.run("UPDATE sites_site SET updated_at = ? WHERE id = ?", ctx.now(), site.id);
  return { ok: true };
}

async function sitesEnvList(ctx: Ctx, input: unknown): Promise<{ entries: unknown[]; wanted: string[] }> {
  const site = mustSite(ctx, reqStr(ctx, rec(ctx, input), "siteId"));
  const rows = many(ctx, "SELECT * FROM sites_env WHERE site_id = ?", site.id).sort((a, b) => str(a.name).localeCompare(str(b.name)));
  const current = isNull(site.current_deployment) ? null : one(ctx, "SELECT * FROM sites_deployment WHERE id = ?", site.current_deployment);
  const injected = current ? num(current.at) : 0;
  const last = one(ctx, "SELECT * FROM sites_deployment WHERE site_id = ? AND plan IS NOT NULL ORDER BY at DESC", site.id);
  const plan = parseJson<{ env?: string[]; needs?: string[] }>(last?.plan, {});
  const have = new Set([...rows.map((r) => str(r.name)), ...Object.keys(addonNames(ctx, str(site.id)))]);
  const wanted = (plan.env ?? []).filter((n) => !have.has(n) && !RESERVED_ENV.has(n) && n !== "NODE_ENV");
  return { entries: rows.map((r) => ({ name: str(r.name), vaultName: str(r.vault_handle), injected: injected > 0 })), wanted };
}

function addonNames(ctx: Ctx, siteId: string): Record<string, true> {
  const out: Record<string, true> = {};
  for (const a of many(ctx, "SELECT * FROM sites_addon WHERE site_id = ?", siteId)) {
    if (a.kind === "postgres") for (const n of ["DATABASE_URL", "PGHOST", "PGPORT", "PGUSER", "PGPASSWORD", "PGDATABASE"]) out[n] = true;
    if (a.kind === "redis") out.REDIS_URL = true;
  }
  return out;
}

const randomPassword = (): string => Array.from(globalThis.crypto.getRandomValues(new Uint8Array(24)), (b) => b.toString(16).padStart(2, "0")).join("");

async function sitesAddonAdd(ctx: Ctx, input: unknown): Promise<{ addon: unknown }> {
  const o = rec(ctx, input);
  const site = mustSite(ctx, reqStr(ctx, o, "siteId"));
  const kind = reqStr(ctx, o, "kind") as AddonKind;
  if (kind !== "postgres" && kind !== "redis") fail(ctx, "validation.bad_input", "Postgres or Redis.", { field: "kind" });
  const r = runner();
  if (!r) fail(ctx, "validation.precondition_failed", deployNeed() ?? "No server can run it.");
  const siteId = str(site.id);
  const envName = kind === "postgres" ? "DATABASE_URL" : "REDIS_URL";
  const had = one(ctx, "SELECT * FROM sites_addon WHERE site_id = ? AND kind = ?", siteId, kind);
  const password = had ? await secretOf(ctx, had) : randomPassword();
  await keepNetwork(ctx.db, r, siteId);
  if (!had) ctx.db.run("INSERT INTO sites_addon (site_id, kind, container_id, state, env_name, secret, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", siteId, kind, null, "starting", envName, JSON.stringify(ctx.seal.seal(new TextEncoder().encode(password), `site-addon:${siteId}:${kind}`)), null, ctx.now());
  try {
    const made = await r.addon({ siteId, kind, password });
    // ready when it takes a connection
    let ok = false;
    for (let i = 0; i < 60 && !ok; i++) {
      const probe = kind === "postgres" ? await r.exec(made.containerId, ["pg_isready", "-U", "app", "-d", "app", "-h", "127.0.0.1"], {}) : await r.exec(made.containerId, ["redis-cli", "-a", password, "--no-auth-warning", "ping"], {});
      ok = probe.code === 0 && (kind === "postgres" || /PONG/.test(probe.out));
      if (!ok) await new Promise((res) => setTimeout(res, 500));
    }
    ctx.db.run("UPDATE sites_addon SET container_id = ?, state = ?, detail = ? WHERE site_id = ? AND kind = ?", made.containerId, ok ? "ready" : "failed", ok ? null : "It started but does not take connections yet.", siteId, kind);
  } catch (e) {
    ctx.db.run("UPDATE sites_addon SET state = ?, detail = ? WHERE site_id = ? AND kind = ?", "failed", (e instanceof Error ? e.message : String(e)).slice(0, 200), siteId, kind);
  }
  const row = one(ctx, "SELECT * FROM sites_addon WHERE site_id = ? AND kind = ?", siteId, kind) as Row;
  ctx.db.run("UPDATE sites_site SET updated_at = ? WHERE id = ?", ctx.now(), siteId);
  return { addon: { kind, state: str(row.state), envName, ...(isNull(row.detail) ? {} : { detail: str(row.detail) }) } };
}

async function sitesAddonRemove(ctx: Ctx, input: unknown): Promise<{ removed: boolean }> {
  const o = rec(ctx, input);
  const site = mustSite(ctx, reqStr(ctx, o, "siteId"));
  const kind = reqStr(ctx, o, "kind") as AddonKind;
  const row = one(ctx, "SELECT * FROM sites_addon WHERE site_id = ? AND kind = ?", site.id, kind);
  if (!row) return { removed: false };
  await runner()?.removeAddon(str(site.id), kind);
  ctx.db.run("DELETE FROM sites_addon WHERE site_id = ? AND kind = ?", site.id, kind);
  return { removed: true };
}

async function sitesDbImport(ctx: Ctx, input: unknown): Promise<{ ok: boolean; detail: string }> {
  const o = rec(ctx, input);
  const site = mustSite(ctx, reqStr(ctx, o, "siteId"));
  const fileId = optStr(ctx, o, "fileId");
  const fromHandle = optStr(ctx, o, "fromHandle");
  if ((fileId === undefined) === (fromHandle === undefined)) fail(ctx, "validation.bad_input", "Give a pg_dump file from Files, or the Vault key that holds the old connection string.", { field: "fileId" });
  const r = runner();
  if (!r) fail(ctx, "validation.precondition_failed", deployNeed() ?? "No server can run it.");
  const pg = one(ctx, "SELECT * FROM sites_addon WHERE site_id = ? AND kind = ?", site.id, "postgres");
  if (!pg || isNull(pg.container_id) || pg.state !== "ready") fail(ctx, "validation.precondition_failed", "Add the site's Postgres first, then copy the data into it.");
  const container = str(pg.container_id);
  const local = { PGPASSWORD: await secretOf(ctx, pg), PGUSER: "app", PGDATABASE: "app", PGHOST: "127.0.0.1" };
  let res: { code: number; out: string };
  if (fromHandle !== undefined) {
    if (!HANDLE.test(fromHandle)) fail(ctx, "validation.bad_input", "A Vault key is written as #Name.", { field: "fromHandle" });
    const from = await filled(ctx, fromHandle, `${str(site.id)}:import:${ctx.now()}`);
    if (!/^postgres(ql)?:\/\//.test(from)) fail(ctx, "validation.bad_input", "That Vault key does not hold a postgres:// connection string.", { field: "fromHandle" });
    // pg_dump runs in the site's own Postgres container, which has the client; the old address goes in through the exec's environment only
    res = await r.exec(container, ["sh", "-c", 'pg_dump --no-owner --no-acl --clean --if-exists "$VYRE_FROM" | psql -v ON_ERROR_STOP=0 -q'], { ...local, VYRE_FROM: from });
  } else {
    const got = (await ctx.call("files.read", { fileId, as: "base64" })) as { base64?: string };
    if (typeof got.base64 !== "string") fail(ctx, "validation.precondition_failed", "That file could not be read.");
    const bytes = new Uint8Array(Buffer.from(got.base64, "base64"));
    await r.put(container, "/tmp", "vyre-import.dump", bytes);
    // a custom-format dump starts with PGDMP and goes through pg_restore; a plain one is SQL
    const custom = Buffer.from(bytes.subarray(0, 5)).toString("latin1") === "PGDMP";
    res = await r.exec(container, ["sh", "-c", custom ? "pg_restore --no-owner --no-acl --clean --if-exists -d app /tmp/vyre-import.dump; s=$?; rm -f /tmp/vyre-import.dump; exit $s" : "psql -v ON_ERROR_STOP=0 -q -f /tmp/vyre-import.dump; s=$?; rm -f /tmp/vyre-import.dump; exit $s"], local);
  }
  const tables = await r.exec(container, ["psql", "-tAc", "select count(*) from information_schema.tables where table_schema not in ('pg_catalog','information_schema')"], local);
  const n = Number(tables.out.trim().split("\n").pop()) || 0;
  const errors = res.out.split("\n").filter((l) => /ERROR/.test(l));
  const ok = n > 0 && (res.code === 0 || errors.length < 5);
  return { ok, detail: ok ? `Copied. The database has ${n} table${n === 1 ? "" : "s"}${errors.length ? `; ${errors.length} line${errors.length === 1 ? "" : "s"} did not apply (often roles or extensions that are not needed)` : ""}.` : `It did not copy: ${(errors[0] ?? res.out.trim().split("\n").pop() ?? "no detail").slice(0, 200)}` };
}

async function sitesPlan(ctx: Ctx, input: unknown): Promise<Record<string, unknown>> {
  const o = rec(ctx, input);
  const siteId = optStr(ctx, o, "siteId");
  const site = siteId ? mustSite(ctx, siteId) : null;
  const source = o.source ? cleanSource(ctx, o.source) : site ? sourceOf(site) : null;
  if (!source) fail(ctx, "validation.precondition_failed", "Give a source to read.");
  const token = source.tokenHandle ? await filled(ctx, source.tokenHandle, `plan:${ctx.now()}`) : null;
  let fetched: Awaited<ReturnType<typeof fetchSource>> | null = null;
  try {
    fetched = await fetchSource(source, { call: (c, i) => ctx.call(c as never, i), token: async () => token, contained: routesHost()?.contained === true, ...(routesHost()?.tmp ? { tmp: routesHost()!.tmp! } : {}) });
    const p = await sitePlan(fetched.dir);
    return { kind: p.kind, note: p.note, ...(p.build ? { build: p.build } : {}), ...(p.start ? { start: p.start } : {}), port: p.port, needs: p.needs, env: p.env, from: p.from };
  } catch (e) {
    return fail(ctx, "validation.precondition_failed", e instanceof Error ? e.message : String(e));
  } finally { fetched?.cleanup(); }
}

// a password is kept as PBKDF2-SHA256 of it with a salt of its own; Web Crypto, so nothing here needs node:crypto
const ITER = 210_000;
const toHex = (b: ArrayBuffer | Uint8Array): string => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");
async function pbkdf2(password: string, salt: Uint8Array, iter: number): Promise<string> {
  const key = await globalThis.crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  return toHex(await globalThis.crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: iter }, key, 256));
}
export async function hashPassword(password: string): Promise<string> {
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ITER}$${toHex(salt)}$${await pbkdf2(password, salt, ITER)}`;
}
export async function checkPassword(password: string, stored: string): Promise<boolean> {
  const [kind, iter, salt, hash] = stored.split("$");
  if (kind !== "pbkdf2" || !iter || !salt || !hash) return false;
  const got = await pbkdf2(password, Uint8Array.from((salt.match(/../g) ?? []).map((h) => parseInt(h, 16))), Number(iter));
  let diff = got.length ^ hash.length;
  for (let i = 0; i < Math.min(got.length, hash.length); i++) diff |= got.charCodeAt(i) ^ hash.charCodeAt(i);
  return diff === 0;
}

async function sitesPasswordSet(ctx: Ctx, input: unknown): Promise<{ ok: boolean }> {
  const o = rec(ctx, input);
  const site = mustSite(ctx, reqStr(ctx, o, "siteId"));
  const password = reqStr(ctx, o, "password");
  if (password.length < 8 || password.length > 200) fail(ctx, "validation.bad_input", "A site password is 8 to 200 characters.", { field: "password" });
  ctx.db.run("UPDATE sites_site SET password_hash = ?, updated_at = ? WHERE id = ?", await hashPassword(password), ctx.now(), site.id);
  // whoever had the old password signs in again
  ctx.db.run("DELETE FROM sites_ticket WHERE site_id = ? AND principal = ?", site.id, "visitor:password");
  return { ok: true };
}

const hashHex = async (text: string): Promise<string> => toHex(await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
const SIGNIN_MS = 2 * 60_000;
export const SESSION_MS = 24 * 60 * 60_000;

/** A ticket for one person and one site: in the sign-in link for two minutes, then traded at the site's address for a day-long cookie. */
export async function newTicket(db: Db, siteId: string, principal: string, ms: number, now: number): Promise<string> {
  const token = toHex(globalThis.crypto.getRandomValues(new Uint8Array(24)));
  db.run("DELETE FROM sites_ticket WHERE expires_at < ?", now);
  db.run("INSERT INTO sites_ticket (token_hash, site_id, principal, expires_at) VALUES (?, ?, ?, ?)", await hashHex(token), siteId, principal, now + ms);
  return token;
}

async function sitesSigninLink(ctx: Ctx, input: unknown): Promise<{ url: string; expiresAt: number }> {
  const o = rec(ctx, input);
  const site = mustSite(ctx, reqStr(ctx, o, "siteId"));
  if (ctx.principal.kind !== "person") fail(ctx, "permission.no_grant", "Only a person signs in to a site.");
  const host = siteHostOf(site);
  if (!host) fail(ctx, "validation.precondition_failed", "This site has no address of its own yet.");
  const access = str(site.access);
  if (access === "private" && site.owner !== ctx.principal.id && ctx.authorize({ perm: null, level: "view" }, { type: "site", id: str(site.id) }).effect !== "allow") fail(ctx, "permission.no_grant", "This site is not shared with you.");
  const nextRaw = optStr(ctx, o, "next") ?? "/";
  const next = nextRaw.startsWith("/") && !nextRaw.startsWith("//") ? nextRaw.slice(0, 2000) : "/";
  const token = await newTicket(ctx.db, str(site.id), ctx.principal.id, SIGNIN_MS, ctx.now());
  return { url: `https://${host}/__vyre/signin?t=${token}&next=${encodeURIComponent(next)}`, expiresAt: ctx.now() + SIGNIN_MS };
}

/** The address a site has of its own: a custom domain with its certificate, else <slug>.<sites domain>. */
export function siteHostOf(site: Row): string | null {
  const domain = (routesHost()?.domainOf?.(str(site.id))) ?? null;
  if (domain) return domain;
  const base = routesHost()?.sitesDomain?.() ?? null;
  return base && !isNull(site.slug) ? `${str(site.slug)}.${base}` : null;
}

/** For the host's push check: sites that deploy on a push, with whom to run the deploy as. */
export function autoDeploySites(ctx: Pick<Ctx, "db">): { siteId: string; as: string }[] {
  return (ctx.db.all("SELECT * FROM sites_site WHERE auto_deploy = 1 AND deleted_at IS NULL AND source IS NOT NULL") as Row[])
    .filter((r) => sourceOf(r)?.repo)
    .map((r) => ({ siteId: str(r.id), as: isNull(r.deployed_by) ? str(r.owner) : str(r.deployed_by) }));
}

/** Containers that should be serving, for the host to start again after a server restart (Docker restarts them itself; this catches one that was removed). */
export function servingContainers(ctx: Pick<Ctx, "db">): { siteId: string; containerId: string }[] {
  return (ctx.db.all("SELECT id, container_id FROM sites_site WHERE container_id IS NOT NULL AND deleted_at IS NULL") as Row[]).map((r) => ({ siteId: str(r.id), containerId: str(r.container_id) }));
}

/** When a deployed site is stopped or deleted, its container goes; the images stay until the site is deleted. */
export async function stopDeployed(ctx: Ctx, site: Row, removeAll: boolean): Promise<void> {
  const r = runner();
  if (!r) return;
  if (!isNull(site.container_id) && removeAll) await r.remove(str(site.container_id)).catch(() => undefined);
  if (removeAll) {
    for (const d of many(ctx, "SELECT * FROM sites_deployment WHERE site_id = ? AND image IS NOT NULL", site.id)) await r.removeImage(str(d.image)).catch(() => undefined);
    for (const a of many(ctx, "SELECT * FROM sites_addon WHERE site_id = ?", site.id)) await r.removeAddon(str(site.id), str(a.kind) as AddonKind).catch(() => undefined);
    await r.removeNetwork(str(site.id)).catch(() => undefined);
    ctx.db.run("DELETE FROM sites_addon WHERE site_id = ?", site.id);
    ctx.db.run("UPDATE sites_site SET container_id = NULL WHERE id = ?", site.id);
  }
}

/** The build log of a deployment, or the running app's own log. */
export async function deployedLogs(ctx: Ctx, site: Row, o: Record<string, unknown>, tail: number): Promise<{ lines: string[]; state?: string }> {
  const build = o.build === true;
  const wanted = typeof o.deploymentId === "string" ? o.deploymentId : undefined;
  if (build || wanted) {
    const d = wanted ? one(ctx, "SELECT * FROM sites_deployment WHERE id = ? AND site_id = ?", wanted, site.id) : one(ctx, "SELECT * FROM sites_deployment WHERE site_id = ? AND env = ? ORDER BY at DESC", site.id, "production");
    if (!d) return { lines: [] };
    return { lines: parseJson<string[]>(d.log, []).slice(-tail), state: str(d.state) };
  }
  const r = runner();
  if (!r || isNull(site.container_id)) return { lines: [] };
  try { return { lines: await r.logs(str(site.container_id), tail) }; } catch { return { lines: [] }; }
}

export const releaseHandlers = {
  "sites.deploy": (ctx: Ctx, input: unknown) => sitesDeploy(ctx, input),
  "sites.deployments": (ctx: Ctx, input: unknown) => sitesDeployments(ctx, input),
  "sites.rollback": (ctx: Ctx, input: unknown) => sitesRollback(ctx, input),
  "sites.env_set": (ctx: Ctx, input: unknown) => sitesEnvSet(ctx, input),
  "sites.env_list": (ctx: Ctx, input: unknown) => sitesEnvList(ctx, input),
  "sites.addon_add": (ctx: Ctx, input: unknown) => sitesAddonAdd(ctx, input),
  "sites.addon_remove": (ctx: Ctx, input: unknown) => sitesAddonRemove(ctx, input),
  "sites.db_import": (ctx: Ctx, input: unknown) => sitesDbImport(ctx, input),
  "sites.plan": (ctx: Ctx, input: unknown) => sitesPlan(ctx, input),
  "sites.password_set": (ctx: Ctx, input: unknown) => sitesPasswordSet(ctx, input),
  "sites.signin_link": (ctx: Ctx, input: unknown) => sitesSigninLink(ctx, input),
};

export const _test = { diagnose, enqueue, hexOf };
