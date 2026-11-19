// Sites Vyre builds and runs (owner, 3 Nov: "deploy it on here instead of Railway"). A site with a source is built into an image and run as its own container on a server of the Space
// (handlers/runner.ts), and its address points at that container. Each deploy is a row of sites_deployment (env production): it is queued, built, started, checked, and only then does
// the address switch to it; until then the last good build keeps serving, and a failed one leaves it serving. Rollback starts an earlier build's image again.
//   env       sites_env: a name and a Vault handle. Values are filled from the Vault at deploy time, into this deploy only, and reach the container's environment and nothing else
//   addons    a Postgres or Redis of the site's own on its network, its address given as DATABASE_URL or REDIS_URL; the password is sealed in sites_addon
//   failures  every one ends in plain words and one fix (fix: set_env, add_postgres, add_redis, retry, set_start, set_port, open_logs, connect_repo, free_space, more_memory)
// The work after the call answers (fetch, build, start) runs here in the background on the module's own db handle; the deploy row is how the app, an agent and the build log follow it.
//   steps     a deploy is four steps (fetch, build, start, check), each with its state, how long it took and where its lines begin in the log, kept beside the log (sites_deployment.steps)
//   cancel    sites.deploy_cancel stops the deploy that is running: the build is cut off, a container that was started is removed, and the last good build keeps serving
// @reads ../migrations/0004_deploy.sql
// @reads ../migrations/0005_deploy_steps.sql
// @reads ../migrations/0006_env_plain.sql
// @reads ../migrations/0015_built_from.sql
// @reads ../migrations/0016_branch_protection.sql
// @reads ../migrations/0017_hook_vault.sql
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import { touchActivity } from "../projections.ts";
import {
  fail,
  flag,
  hexOf,
  isNull,
  many,
  mustSite,
  nid,
  num,
  one,
  optBool,
  optStr,
  rec,
  reqStr,
  str,
} from "./deploy.ts";
import { takeGateFp, uploadFingerprint, wasApproved } from "../../../lib/key-target.ts";
import { looksSecret } from "./secrets.ts";
import { sitePlan } from "./plan.ts";
import type { SitePlan } from "./plan.ts";
import { addonHost, DEFAULT_LIMITS, MIN_FREE_MB } from "./runner.ts";
import type { AddonKind, Limits, Runner } from "./runner.ts";
import { cleanBranch, fetchSource, remoteHead, repoUrl, SourceError } from "./source.ts";
import type { SourceSpec } from "./source.ts";
import { routesHost, siteRunner } from "./route.ts";

type Row = Record<string, unknown>;
type Db = Ctx["db"];
export type Fix =
  | "set_env"
  | "add_postgres"
  | "add_redis"
  | "retry"
  | "set_start"
  | "set_port"
  | "open_logs"
  | "connect_repo"
  | "free_space"
  | "more_memory";

const LOG_KEEP = 3000;
const READY_MS = 120_000;
const KEEP_IMAGES = 5;
const PREVIEW_KEEP = 10;
const WAIT_MAX_MS = 20 * 60_000;
let CANCEL_WAIT_MS = 20_000;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const HANDLE = /^#[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)?$/;
const ENV_SCOPES = new Set(["all", "production", "previews"]);
const RESERVED_ENV = new Set(["PORT", "HOST", "HOSTNAME", "PATH", "HOME"]);

const runner = (): Runner | null => siteRunner();

/** Why this Space cannot build and run apps, in a sentence, or null when it can. */
export function deployNeed(): string | null {
  if (!siteRunner())
    return "This server has no sites runner, so Vyre cannot build and run apps here yet. Updating Vyre Server adds it.";
  return null;
}

// ---- shapes

export function parseJson<T>(text: unknown, fallback: T): T {
  if (typeof text !== "string" || text === "") return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

export function depRow(r: Row, currentId: string | null): Record<string, unknown> {
  // a deploy this process is not running, still marked as running, was cut off by a restart of the server: it says so, with the fix
  const orphan = (r.state === "queued" || r.state === "building") && !done.has(str(r.id));
  if (orphan)
    return {
      ...depRow(
        {
          ...r,
          state: "failed",
          problem: "The server restarted during this deploy. Deploy again.",
          fix: "retry",
          steps: JSON.stringify(closedMeta(parseJson<StepMeta | null>(r.steps, null))),
        },
        currentId,
      ),
    };
  const steps = stepsOut(parseJson<StepMeta | null>(r.steps, null));
  return {
    deploymentId: str(r.id),
    siteId: str(r.site_id),
    env: str(r.env),
    state: str(r.state),
    at: num(r.at),
    ...(isNull(r.url) ? {} : { url: str(r.url) }),
    ...(isNull(r.branch) ? {} : { branch: str(r.branch) }),
    ...(isNull(r.commit_sha) ? {} : { commit: str(r.commit_sha) }),
    ...(isNull(r.message) || r.message === undefined || str(r.message) === "" ? {} : { message: str(r.message) }),
    by: str(r.created_by),
    ...(isNull(r.note) ? {} : { note: str(r.note) }),
    ...(isNull(r.problem) ? {} : { problem: str(r.problem) }),
    ...(isNull(r.fix) ? {} : { fix: str(r.fix) }),
    current: currentId !== null && r.id === currentId,
    ...(isNull(r.finished_at) ? {} : { finishedAt: num(r.finished_at) }),
    ...(steps ? { steps } : {}),
  };
}

// ---- the four steps of a deploy

export type StepKey = "fetch" | "build" | "start" | "check";
export type StepState = "waiting" | "running" | "ok" | "failed" | "skipped";
/** A step as it is kept: its state, when it began, how long it took, and the line of the whole log (counted from the first line ever printed) where its lines begin. */
interface StepRow {
  k: StepKey;
  s: StepState;
  at?: number;
  ms?: number;
  line?: number;
}
/** What sites_deployment.steps holds: the steps, and how many lines were left out of the front of the kept log. */
interface StepMeta {
  d: number;
  s: StepRow[];
}
const STEP_KEYS: readonly StepKey[] = ["fetch", "build", "start", "check"];
const LEFT_OUT = /^\.\.\. (\d+) earlier lines left out$/;

/** A deploy that will never go on: the step that ran failed, the ones after it never ran. */
function closedMeta(m: StepMeta | null): StepMeta | null {
  if (!m) return null;
  return {
    d: m.d,
    s: m.s.map((x) => (x.s === "running" ? { ...x, s: "failed" } : x.s === "waiting" ? { ...x, s: "skipped" } : x)),
  };
}

function stepsOut(m: StepMeta | null): Record<string, unknown>[] | null {
  if (!m || !Array.isArray(m.s)) return null;
  return m.s.map((x) => ({
    key: x.k,
    state: x.s,
    ...(x.ms !== undefined ? { ms: x.ms } : {}),
    ...(x.s === "running" && x.at !== undefined ? { startedAt: x.at } : {}),
  }));
}

/** The steps with where each one's lines begin in `shown`, the last lines of a kept log of `kept` lines. */
function stepsIn(m: StepMeta | null, kept: number, shown: number): Record<string, unknown>[] | null {
  const out = stepsOut(m);
  if (!m || !out) return null;
  return out.map((o, i) => {
    const line = m.s[i]?.line;
    if (line === undefined) return o;
    // the kept log starts with one line that says how many were left out, when any were
    const inKept = Math.max(0, line - m.d) + (m.d > 0 ? 1 : 0);
    return { ...o, from: Math.min(shown, Math.max(0, inKept - (kept - shown))) };
  });
}

export function sourceOf(r: Row): SourceSpec | null {
  return parseJson<SourceSpec | null>(r.source, null);
}
export function limitsOf(r: Row): Limits {
  return { ...DEFAULT_LIMITS, ...parseJson<Partial<Limits>>(r.limits, {}) };
}

/** Check a source given by a person or agent; tokens only as Vault handles. */
export function cleanSource(ctx: Ctx, raw: unknown): SourceSpec {
  const o = rec(ctx, raw);
  const s: SourceSpec = {};
  for (const k of ["repo", "branch", "tokenHandle", "folderId", "fileId", "path", "root"] as const) {
    const v = optStr(ctx, o, k);
    if (v !== undefined && v.trim() !== "") s[k] = v.trim();
  }
  const given = [s.repo, s.folderId, s.fileId, s.path].filter(Boolean).length;
  if (given !== 1)
    fail(
      ctx,
      "validation.bad_input",
      "Give one source: a GitHub repo, a folder or zip in Files, or a folder on this computer.",
      { field: "source" },
    );
  try {
    if (s.repo) repoUrl(s.repo);
    if (s.branch) cleanBranch(s.branch);
  } catch (e) {
    fail(ctx, "validation.bad_input", e instanceof Error ? e.message : "That repo cannot be used.", {
      field: "source.repo",
    });
  }
  if (s.tokenHandle && !HANDLE.test(s.tokenHandle))
    fail(ctx, "validation.bad_input", "A Vault key is written as #Name.", { field: "source.tokenHandle" });
  if (s.root && (s.root.includes("..") || s.root.startsWith("/")))
    fail(ctx, "validation.bad_input", "The app folder is a path inside the project, like apps/web.", {
      field: "source.root",
    });
  if (s.folderId && ctx.authorize({ perm: null, level: "view" }, { type: "folder", id: s.folderId }).effect !== "allow")
    fail(ctx, "permission.no_grant", "You cannot read that folder.", { folderId: s.folderId });
  if (!s.repo) delete s.branch;
  return s;
}

export function cleanLimits(ctx: Ctx, raw: unknown): Limits {
  const o = rec(ctx, raw);
  const cpus = typeof o.cpus === "number" ? o.cpus : DEFAULT_LIMITS.cpus;
  const memoryMb = typeof o.memoryMb === "number" ? Math.trunc(o.memoryMb) : DEFAULT_LIMITS.memoryMb;
  const diskMb = typeof o.diskMb === "number" ? Math.trunc(o.diskMb) : DEFAULT_LIMITS.diskMb;
  if (!(cpus >= 0.1 && cpus <= 16))
    fail(ctx, "validation.bad_input", "CPUs are between 0.1 and 16.", { field: "limits.cpus" });
  if (!(memoryMb >= 128 && memoryMb <= 65536))
    fail(ctx, "validation.bad_input", "Memory is between 128 MB and 64 GB.", { field: "limits.memoryMb" });
  if (diskMb !== undefined && !(diskMb >= 256 && diskMb <= 1048576))
    fail(ctx, "validation.bad_input", "Disk is between 256 MB and 1 TB.", { field: "limits.diskMb" });
  return { cpus, memoryMb, ...(diskMb !== undefined ? { diskMb } : {}) };
}

// ---- the log of a deploy

/** Lines are kept in memory and written every few hundred milliseconds, so a build that prints fast does not write a row per line, and the app sees them within a second. The steps are written with them, so the log and where each step begins in it never disagree. */
class DeployLog {
  private lines: string[];
  private dropped = 0;
  private steps: StepRow[] | null;
  private dirty = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private db: Db;
  private id: string;
  constructor(db: Db, id: string, start: { lines?: string[]; meta?: StepMeta | null; steps?: boolean } = {}) {
    this.db = db;
    this.id = id;
    this.lines = start.lines ? [...start.lines] : [];
    const left = LEFT_OUT.exec(this.lines[0] ?? "");
    if (left) {
      this.lines.shift();
      this.dropped = start.meta?.d ?? Number(left[1]);
    }
    this.steps = start.meta?.s
      ? start.meta.s.map((x) => ({ ...x }))
      : start.steps
        ? STEP_KEYS.map((k) => ({ k, s: "waiting" as const }))
        : null;
    this.timer = setInterval(() => this.flush(), 400);
    this.timer.unref?.();
  }
  add(line: string): void {
    for (const l of line.split("\n")) {
      const t = l
        .replace(/\u001b\[[0-9;?]*[A-Za-z]/g, "")
        .replace(/\r/g, "")
        .trimEnd();
      if (t === "") continue;
      this.lines.push(t.length > 600 ? `${t.slice(0, 600)}...` : t);
    }
    if (this.lines.length > LOG_KEEP) {
      const over = this.lines.length - LOG_KEEP;
      this.dropped += over;
      this.lines = this.lines.slice(over);
    }
    this.dirty = true;
  }
  tail(n: number): string[] {
    return this.lines.slice(-n);
  }
  /** A step begins: the one that ran before it ended well. */
  begin(k: StepKey): void {
    if (!this.steps) return;
    const now = Date.now();
    for (const x of this.steps) if (x.s === "running") Object.assign(x, { s: "ok", ms: now - (x.at ?? now) });
    const step = this.steps.find((x) => x.k === k);
    if (step) Object.assign(step, { s: "running", at: now, line: this.dropped + this.lines.length });
    this.dirty = true;
  }
  /** Steps that never happen for this deploy (a promoted preview is not fetched or built). */
  skip(...keys: StepKey[]): void {
    if (!this.steps) return;
    for (const x of this.steps) if (keys.includes(x.k)) x.s = "skipped";
    this.dirty = true;
  }
  /** The deploy ended: the step that ran ended with it, and after a failure the ones that never ran say so. */
  settle(ok: boolean): void {
    if (!this.steps) return;
    const now = Date.now();
    for (const x of this.steps) {
      if (x.s === "running") Object.assign(x, { s: ok ? "ok" : "failed", ms: now - (x.at ?? now) });
      else if (x.s === "waiting") x.s = "skipped";
    }
    this.dirty = true;
  }
  flush(): void {
    if (!this.dirty) return;
    this.dirty = false;
    const kept = this.dropped > 0 ? [`... ${this.dropped} earlier lines left out`, ...this.lines] : this.lines;
    try {
      this.db.run(
        "UPDATE sites_deployment SET log = ?, steps = COALESCE(?, steps), updated_at = ? WHERE id = ?",
        JSON.stringify(kept),
        this.steps ? JSON.stringify({ d: this.dropped, s: this.steps } satisfies StepMeta) : null,
        Date.now(),
        this.id,
      );
    } catch {
      /* the Space is stopping */
    }
  }
  close(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.flush();
  }
}

// ---- reading what went wrong

/** Plain words and one fix for a build or start that failed, from what it printed. */
export function diagnose(
  lines: readonly string[],
  a: {
    stage: "source" | "build" | "start";
    plan?: SitePlan | null;
    port?: number;
    oom?: boolean;
    memoryMb?: number;
    hasPostgres?: boolean;
    hasRedis?: boolean;
    envSet?: ReadonlySet<string>;
  },
): { problem: string; fix: Fix } {
  const text = lines.slice(-200).join("\n");
  if (a.oom || /JavaScript heap out of memory|Killed\s*$|exit code: 137|returned a non-zero code: 137/im.test(text)) {
    return a.stage === "build"
      ? {
          problem:
            "The build ran out of memory. It gets 3 GB; a smaller build step or a server with more memory fixes it.",
          fix: "open_logs",
        }
      : {
          problem: `It ran out of memory (${a.memoryMb ?? DEFAULT_LIMITS.memoryMb} MB). Give it more memory and deploy again.`,
          fix: "more_memory",
        };
  }
  if (/no space left on device/i.test(text))
    return { problem: "The server's disk is full. Remove old sites or builds, then deploy again.", fix: "free_space" };
  if (a.stage === "start") {
    if (
      /ECONNREFUSED[^\n]*(:5432|postgres)|could not connect to server|connection to server at .*5432|password authentication failed|database .* does not exist|getaddrinfo [A-Z_]+ postgres|P1001|DATABASE_URL/i.test(
        text,
      ) &&
      !a.hasPostgres
    ) {
      return {
        problem: "It needs a Postgres database and has none. Add one: it gets DATABASE_URL.",
        fix: "add_postgres",
      };
    }
    if (/ECONNREFUSED[^\n]*:6379|Redis connection|getaddrinfo [A-Z_]+ redis|REDIS_URL/i.test(text) && !a.hasRedis)
      return { problem: "It needs Redis and has none. Add one: it gets REDIS_URL.", fix: "add_redis" };
    const missing =
      /(?:missing|required|not set|undefined|is not defined)[^\n]{0,40}\b([A-Z][A-Z0-9_]{2,})\b|\b([A-Z][A-Z0-9_]{2,})\b[^\n]{0,30}(?:is missing|is required|is not set|must be set|not found in env)/.exec(
        text,
      );
    const name = missing?.[1] ?? missing?.[2];
    if (name && !a.envSet?.has(name) && !/^(PORT|HOST|NODE_ENV|PATH)$/.test(name))
      return { problem: `It stopped because ${name} is not set. Add it from the Vault.`, fix: "set_env" };
    if (/Missing script: "?start"?|missing script: start/i.test(text))
      return {
        problem: 'There is no start script. Add "start" to package.json, a Procfile web line, or a start command.',
        fix: "set_start",
      };
    if (/Cannot find module|ModuleNotFoundError|No module named/i.test(text))
      return {
        problem: `It could not find a module it imports: ${/(Cannot find module '[^']+'|No module named '?[\w.]+'?)/.exec(text)?.[1] ?? "see the log"}. Add it to the dependencies.`,
        fix: "open_logs",
      };
    if (/EADDRINUSE|address already in use/i.test(text))
      return { problem: "Two things in it want the same port. Start only the web server.", fix: "set_start" };
    if (a.port !== undefined && !/error/i.test(text.split("\n").slice(-5).join("\n")))
      return {
        problem: `It started, but nothing answers on port ${a.port}. Make the app listen on the PORT env var, on 0.0.0.0.`,
        fix: "set_port",
      };
    return { problem: `It stopped right after starting: ${lastError(lines) ?? "the log says why"}.`, fix: "open_logs" };
  }
  if (a.stage === "build") {
    if (/npm ERR! (code )?ERESOLVE|Could not resolve dependency/i.test(text))
      return {
        problem:
          "npm could not settle the dependencies. Commit a package-lock.json that installs, or fix the versions.",
        fix: "open_logs",
      };
    if (/npm ci.*can only install|package-lock\.json.*(not in sync|out of sync)/i.test(text))
      return {
        problem: "package-lock.json does not match package.json. Run npm install and commit the lock file.",
        fix: "open_logs",
      };
    if (/Missing script: "?build"?/i.test(text))
      return { problem: "The build step names a script package.json does not have.", fix: "set_start" };
    if (/Failed to compile|Type error:|error TS\d+/i.test(text))
      return { problem: `The app did not compile: ${lastError(lines) ?? "see the log"}.`, fix: "open_logs" };
    if (/pull access denied|manifest unknown|not found: manifest/i.test(text))
      return {
        problem: "The Dockerfile starts FROM an image this server cannot fetch. Check the image name.",
        fix: "open_logs",
      };
    return {
      problem: `The build failed: ${lastError(lines) ?? "the last lines of the log say why"}.`,
      fix: "open_logs",
    };
  }
  return { problem: lastError(lines) ?? "The code could not be fetched.", fix: "connect_repo" };
}

function lastError(lines: readonly string[]): string | null {
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 60); i--) {
    const l = (lines[i] ?? "").trim();
    if (/error|failed|cannot|could not|not found|exception|denied/i.test(l) && l.length > 8)
      return l.replace(/^(npm ERR!|ERROR:?|error:?)\s*/i, "").slice(0, 220);
  }
  return null;
}

// ---- env, tokens and addons, filled while the call is still the caller's

async function filled(ctx: Ctx, handle: string, ref: string): Promise<string> {
  const h = routesHost();
  if (!h?.take)
    fail(ctx, "validation.precondition_failed", "This server cannot fill values from the Vault into a site.");
  try {
    await ctx.vault.fill(handle, { kind: "container_env", ref });
  } catch (e) {
    fail(
      ctx,
      "permission.no_grant",
      `You cannot use the Vault key ${handle}, or it is empty. Ask for access or pick another.`,
      { handle, error: e instanceof Error ? e.message.slice(0, 120) : "" },
    );
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
    if (a.kind === "postgres")
      Object.assign(out, {
        DATABASE_URL: `postgres://app:${pass}@${host}:5432/app`,
        PGHOST: host,
        PGPORT: "5432",
        PGUSER: "app",
        PGPASSWORD: decodeURIComponent(pass),
        PGDATABASE: "app",
      });
    if (a.kind === "redis") out.REDIS_URL = `redis://default:${pass}@${host}:6379`;
  }
  return out;
}

/** The env vars of a deploy: the site's databases, then each var whose scope applies to this kind of deploy (all, and production or previews). A plain value is used as kept; a secret is filled from the Vault now. */
/** The branches a person named in the site's webhook follow list, one by one: a pattern with a * names none. */
function namedBranches(ctx: Ctx, siteId: string): string[] {
  const site = one(ctx, "SELECT hook_follow FROM sites_site WHERE id = ?", siteId);
  try {
    const v = JSON.parse(!site || isNull(site.hook_follow) ? "[]" : str(site.hook_follow)) as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !x.includes("*")) : [];
  } catch {
    return [];
  }
}

async function envOf(
  ctx: Ctx,
  siteId: string,
  depId: string,
  kind: "production" | "preview" = "production",
  branch?: string,
): Promise<Record<string, string>> {
  // a preview never gets the site's own databases: it would write to production data. It gets the ones its variables name (scope previews).
  const out = kind === "production" ? await addonEnv(ctx, siteId) : {};
  const want = kind === "production" ? "production" : "previews";
  // a Vault key scoped to everything reaches a preview only for a branch a person named in the follow list: a "*" follow, or any branch a push can make, gets plain values and the keys made for previews
  const named = kind === "preview" ? namedBranches(ctx, siteId) : [];
  for (const e of many(ctx, "SELECT * FROM sites_env WHERE site_id = ?", siteId)) {
    const scope = isNull(e.scope) ? "production" : str(e.scope);
    if (scope !== "all" && scope !== want) continue;
    if (kind === "preview" && scope === "all" && isNull(e.plain) && !(branch !== undefined && named.includes(branch)))
      continue;
    out[str(e.name)] = !isNull(e.plain)
      ? str(e.plain)
      : await filled(ctx, str(e.vault_handle), `${depId}:${str(e.name)}`);
  }
  return out;
}

/** The variables of a deploy that is already a row. Its cancel switch is registered first, so a cancel that arrives while the Vault is read is recorded and nothing starts after it; a failure here ends the row instead of leaving it queued. Null: it was canceled. */
async function envForNew(
  ctx: Ctx,
  siteId: string,
  depId: string,
  kind: "production" | "preview",
  ac: AbortController,
  branch?: string,
): Promise<Record<string, string> | null> {
  cancels.set(depId, ac);
  try {
    const env = await envOf(ctx, siteId, depId, kind, branch);
    if (!ac.signal.aborted) return env;
  } catch (e) {
    cancels.delete(depId);
    finish(ctx.db, depId, ac.signal.aborted ? "stopped" : "failed", {
      problem: ac.signal.aborted
        ? "Canceled."
        : e instanceof Error
          ? e.message.slice(0, 200)
          : "Its variables could not be read.",
      fix: ac.signal.aborted ? "retry" : "set_env",
    });
    throw e;
  }
  cancels.delete(depId);
  // the cancel that got here closes the row itself when the job never began (it could not wait for one)
  finish(ctx.db, depId, "stopped", { problem: "Canceled.", fix: "retry" });
  return null;
}

// ---- the background part of a deploy

const queue: Array<() => Promise<void>> = [];
let building = false;
/** One build at a time on a server: two Next.js builds at once can take a small server's memory. */
function enqueue(job: () => Promise<void>): Promise<void> {
  return new Promise((resolve) => {
    queue.push(async () => {
      try {
        await job();
      } finally {
        resolve();
      }
    });
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
  db: Db;
  site: Row;
  depId: string;
  source: SourceSpec;
  env: Record<string, string>;
  token: string | null;
  limits: Limits;
  call(cap: string, input: unknown): Promise<unknown>;
  contained: boolean;
  by: string;
  publicNeedsPromote: boolean;
  signal: AbortSignal;
  /** A preview deploy: its own container at its own address, behind sign-in, never the site's address. */
  preview?: { branch: string; host: string };
  /** For uploaded files: what the files were when the deploy was asked for. The build refuses to go on if the files it fetches are other ones. */
  expectFp?: string | null;
  /** The deploy is by anything but a person on a site with a production Vault key: it builds only files it can prove are the ones that were approved. */
  strict?: boolean;
}

/** The deploys this process is running, by id, with the switch that cancels each. */
const cancels = new Map<string, AbortController>();
/** The deploys whose address is changing hands right now: past the point where a cancel can help, so a cancel says so and changes nothing. */
const switching = new Set<string>();
class Canceled extends Error {}
/** Stops a job that was canceled: a throw in a function of its own, so the job body reads as steps and the lint that asks refusals to come before writes does not take a cancel for one. */
function stopIfCanceled(signal: AbortSignal): void {
  if (signal.aborted) throw new Canceled();
}
function stopIfClosed(db: Db, depId: string): void {
  if (!isOpen(db, depId)) throw new Canceled();
}
/** How a source is fetched; a test replaces it (a repo cannot be cloned there). */
let fetcher: typeof fetchSource = fetchSource;

function finish(
  db: Db,
  depId: string,
  state: "ready" | "failed" | "stopped",
  fields: { problem?: string; fix?: Fix; note?: string },
): void {
  const now = Date.now();
  // a deploy that was closed from outside (a cancel that could not wait) stays as it was closed: nothing the job does later rewrites it
  db.run(
    "UPDATE sites_deployment SET state = ?, problem = ?, fix = ?, note = COALESCE(?, note), finished_at = ?, updated_at = ? WHERE id = ? AND state IN ('queued', 'building')",
    state,
    fields.problem ?? null,
    fields.fix ?? null,
    fields.note ?? null,
    now,
    now,
    depId,
  );
}

/** The deploy is still the job's to finish: it was not closed from outside. Read right before the address changes hands, with nothing awaited in between. */
function isOpen(db: Db, depId: string): boolean {
  const row = (db.all("SELECT state FROM sites_deployment WHERE id = ?", depId) as Row[])[0];
  return row !== undefined && (row.state === "queued" || row.state === "building");
}

/** The deploy row goes from queued to building only if it is still queued: a deploy canceled before the job began never starts. */
function begin(db: Db, depId: string): boolean {
  return (
    db.run(
      "UPDATE sites_deployment SET state = ?, updated_at = ? WHERE id = ? AND state = 'queued'",
      "building",
      Date.now(),
      depId,
    ).changes > 0
  );
}

/** Wait until the new container answers on its port; a container that stops, or never answers, is a failure with its log. */
async function waitReady(
  r: Runner,
  containerId: string,
  port: number,
  health: string,
  log: DeployLog,
  signal?: AbortSignal,
): Promise<{ ok: true } | { ok: false; oom: boolean; lines: string[] }> {
  const h = routesHost();
  const until = Date.now() + READY_MS;
  let seen = 0;
  while (Date.now() < until) {
    if (signal?.aborted) throw new Canceled();
    const st = await r.state(containerId);
    const lines = await r.logs(containerId, 300);
    for (const l of lines.slice(seen)) log.add(l);
    seen = lines.length;
    if (!st || (!st.running && st.exitCode !== undefined && st.exitCode !== 0) || st.oom)
      return { ok: false, oom: st?.oom === true, lines };
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
  const log = new DeployLog(j.db, j.depId, { steps: true });
  const say = (line: string): void => log.add(`==> ${line}`);
  /** The deploy ends here: its steps close with it. */
  const end = (state: "ready" | "failed" | "stopped", fields: { problem?: string; fix?: Fix; note?: string }): void => {
    log.settle(state === "ready");
    finish(j.db, j.depId, state, fields);
  };
  /** Canceled while the last await ran: nothing more is done. */
  const live = (): void => stopIfCanceled(j.signal);
  let fetched: Awaited<ReturnType<typeof fetchSource>> | null = null;
  let plan: SitePlan | null = null;
  let startedId: string | null = null;
  // set when the address starts changing hands: from there a cancel is too late and an error is a failure, never "Canceled"
  let switched = false;
  try {
    live();
    if (!r) {
      end("failed", { problem: deployNeed() ?? "No server can run it.", fix: "retry" });
      return;
    }
    if (!begin(j.db, j.depId)) return;
    log.begin("fetch");
    const free = await r.freeMb();
    live();
    if (free !== null && free < MIN_FREE_MB) {
      say(`Only ${free} MB free on the server's disk.`);
      end("failed", {
        problem: `The server has ${free} MB of disk left, and a build needs ${MIN_FREE_MB} MB. Remove old sites or builds first.`,
        fix: "free_space",
      });
      return;
    }
    say(
      j.source.repo
        ? `Getting ${j.source.repo}${j.source.branch ? ` (${j.source.branch})` : ""}`
        : j.source.fileId
          ? "Unpacking the upload"
          : j.source.folderId
            ? "Reading the folder from Files"
            : `Copying ${j.source.path}`,
    );
    try {
      fetched = await fetcher(j.source, {
        call: j.call,
        token: async () => j.token,
        contained: j.contained,
        ...(routesHost()?.tmp ? { tmp: routesHost()!.tmp! } : {}),
      });
    } catch (e) {
      live();
      const why = e instanceof Error ? e.message : String(e);
      log.add(why);
      end("failed", { problem: why, fix: e instanceof SourceError ? e.fix : "retry" });
      return;
    }
    live();
    // the files this build read are the ones the deploy was asked for (and the Gate looked at), or nothing is built from them
    if (j.strict && (j.source.folderId || j.source.fileId) && (!j.expectFp || !fetched.fp)) {
      const why =
        "The files could not be checked against the ones that were approved, so nothing was built from them. A person can deploy them.";
      log.add(why);
      end("failed", { problem: why, fix: "retry" });
      return;
    }
    if (j.expectFp && fetched.fp && j.expectFp !== fetched.fp) {
      const why = "The files changed while this waited, so nothing was built from them. Ask again.";
      log.add(why);
      end("failed", { problem: why, fix: "retry" });
      return;
    }
    // where this build's code came from, without the token: a promoted preview is judged by it
    {
      const origin: SourceSpec & { fp?: string } = { ...j.source };
      delete origin.tokenHandle;
      // uploaded files carry the fingerprint of the versions this build read (not a later look), so the Gate can tell when they were replaced since
      if ((origin.folderId || origin.fileId) && fetched.fp) origin.fp = fetched.fp;
      j.db.run("UPDATE sites_deployment SET built_from = ? WHERE id = ?", JSON.stringify(origin), j.depId);
    }
    if (fetched.commit) {
      say(`Commit ${fetched.commit.slice(0, 7)}${fetched.message ? `: ${fetched.message}` : ""}`);
      j.db.run(
        "UPDATE sites_deployment SET commit_sha = ?, message = ?, branch = ? WHERE id = ?",
        fetched.commit,
        fetched.message ?? null,
        fetched.branch ?? j.source.branch ?? null,
        j.depId,
      );
    }
    try {
      plan = await sitePlan(fetched.dir);
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      log.add(why);
      end("failed", { problem: why, fix: "set_start" });
      return;
    }
    live();
    say(plan.note);
    const hasPg = "DATABASE_URL" in j.env,
      hasRedis = "REDIS_URL" in j.env;
    if (plan.needs.includes("postgres") && !hasPg)
      say("It looks for a Postgres database (DATABASE_URL). Add one in the site's Database section if it needs it.");
    if (plan.needs.includes("redis") && !hasRedis) say("It looks for Redis (REDIS_URL). Add one if it needs it.");
    const missing = plan.env.filter((n) => !(n in j.env) && !RESERVED_ENV.has(n) && n !== "NODE_ENV");
    if (missing.length)
      say(
        `Its example env names ${missing.slice(0, 12).join(", ")}${missing.length > 12 ? " and more" : ""}, which ${missing.length === 1 ? "is" : "are"} not set.`,
      );
    j.db.run(
      "UPDATE sites_deployment SET note = ?, port = ?, plan = ? WHERE id = ?",
      plan.note,
      plan.port,
      JSON.stringify({
        kind: plan.kind,
        build: plan.build,
        start: plan.start,
        port: plan.port,
        needs: plan.needs,
        env: plan.env,
        from: plan.from,
      }),
      j.depId,
    );
    log.begin("build");
    say("Building");
    const built = await r.build({
      siteId,
      deploymentId: j.depId,
      dir: fetched.dir,
      plan,
      onLine: (l) => log.add(l),
      signal: j.signal,
    });
    fetched.cleanup();
    fetched = null;
    live();
    if (!built.ok) {
      log.add(built.reason);
      const d = diagnose(log.tail(300), { stage: "build", plan });
      end("failed", d);
      return;
    }
    j.db.run("UPDATE sites_deployment SET image = ? WHERE id = ?", built.image, j.depId);
    await keepNetwork(j.db, r, siteId);
    live();
    log.begin("start");
    say(`Starting it with ${j.limits.cpus} CPU and ${j.limits.memoryMb} MB`);
    const started = await r.run({
      siteId,
      deploymentId: j.depId,
      image: built.image,
      port: plan.port,
      env: j.env,
      limits: j.limits,
    });
    startedId = started.containerId;
    if (started.note) say(started.note);
    j.db.run("UPDATE sites_deployment SET container_id = ? WHERE id = ?", started.containerId, j.depId);
    live();
    log.begin("check");
    const ready = await waitReady(r, started.containerId, plan.port, plan.health, log, j.signal);
    live();
    if (!ready.ok) {
      const d = diagnose(ready.lines, {
        stage: "start",
        plan,
        port: plan.port,
        oom: ready.oom,
        memoryMb: j.limits.memoryMb,
        hasPostgres: hasPg,
        hasRedis,
        envSet: new Set(Object.keys(j.env)),
      });
      await r.remove(started.containerId).catch(() => undefined);
      j.db.run("UPDATE sites_deployment SET container_id = NULL WHERE id = ?", j.depId);
      log.add(d.problem);
      end("failed", d);
      return;
    }
    // from here the address changes hands: a cancel that arrives now is too late, and the deploy goes live
    stopIfClosed(j.db, j.depId);
    switched = true;
    switching.add(j.depId);
    if (j.preview) await switchPreview(j.db, r, siteId, j.depId, started.containerId, j.preview);
    else await switchTo(j.db, r, siteId, j.depId, started.containerId, plan.port, j.by, j.publicNeedsPromote);
    say("Live");
    end("ready", {});
  } catch (e) {
    if (switched) {
      await afterSwitchError(j.db, r, siteId, j.depId, startedId, !!j.preview, e, log, end);
      return;
    }
    if (e instanceof Canceled || j.signal.aborted) {
      // the last good build keeps serving; what this deploy started is taken away
      if (startedId && r) {
        await r.remove(startedId).catch(() => undefined);
        j.db.run("UPDATE sites_deployment SET container_id = NULL WHERE id = ?", j.depId);
      }
      say("Canceled");
      end("stopped", { problem: "Canceled.", fix: "retry" });
      return;
    }
    const why = e instanceof Error ? e.message : String(e);
    log.add(why);
    end("failed", { problem: `The deploy stopped: ${why.slice(0, 200)}`, fix: "retry" });
  } finally {
    switching.delete(j.depId);
    fetched?.cleanup();
    log.close();
  }
}

/** An error after the address began to change hands. If the site serves this deploy it is live (what failed was the clean-up after it, which is only said); if not, it failed, and its container is removed, since nothing serves it. Never "Canceled", and the live container is never removed. */
async function afterSwitchError(
  db: Db,
  r: Runner | null,
  siteId: string,
  depId: string,
  startedId: string | null,
  preview: boolean,
  e: unknown,
  log: DeployLog,
  end: (state: "ready" | "failed" | "stopped", fields: { problem?: string; fix?: Fix; note?: string }) => void,
): Promise<void> {
  const why = e instanceof Error ? e.message : String(e);
  log.add(why);
  const site = (db.all("SELECT current_deployment FROM sites_site WHERE id = ?", siteId) as Row[])[0];
  const serving = preview
    ? ((db.all("SELECT host FROM sites_deployment WHERE id = ?", depId) as Row[])[0]?.host ?? null) !== null
    : site !== undefined && site.current_deployment === depId;
  if (serving) {
    end("ready", { note: `It is live. Tidying up after it stopped: ${why.slice(0, 160)}` });
    return;
  }
  if (startedId && r) {
    await r.remove(startedId).catch(() => undefined);
    db.run("UPDATE sites_deployment SET container_id = NULL WHERE id = ?", depId);
  }
  end("failed", { problem: `The deploy stopped before it went live: ${why.slice(0, 200)}`, fix: "retry" });
}

/** The address now serves the new container; the one before is removed, its image kept for a rollback, and images older than the last few are removed. */
async function switchTo(
  db: Db,
  r: Runner,
  siteId: string,
  depId: string,
  containerId: string,
  port: number,
  by: string,
  publicNeedsPromote: boolean,
): Promise<void> {
  const site = (db.all("SELECT * FROM sites_site WHERE id = ?", siteId) as Row[])[0];
  if (!site) return;
  const before = isNull(site.container_id) ? null : str(site.container_id);
  const now = Date.now();
  // a public site goes on the internet only through sites.promote (the Gate); every other access is live at once
  const live = str(site.access) === "public" && publicNeedsPromote && !flag(site.live) ? 0 : 1;
  db.run(
    "UPDATE sites_site SET container_id = ?, port = ?, computer_id = NULL, target_folder = NULL, current_deployment = ?, deployed_by = ?, live = ?, state = ?, updated_at = ? WHERE id = ?",
    containerId,
    port,
    depId,
    by,
    live,
    live ? "ready" : "stopped",
    now,
    siteId,
  );
  db.run("UPDATE sites_deployment SET url = NULL WHERE site_id = ? AND id != ?", siteId, depId);
  touchActivity(db as never, siteId, "site.deployed", now);
  if (before && before !== containerId) {
    await r.remove(before).catch(() => undefined);
    db.run("UPDATE sites_deployment SET container_id = NULL WHERE site_id = ? AND container_id = ?", siteId, before);
  }
  const images = db.all(
    "SELECT id, image FROM sites_deployment WHERE site_id = ? AND env = 'production' AND image IS NOT NULL ORDER BY at DESC",
    siteId,
  ) as Row[];
  for (const old of images.slice(KEEP_IMAGES)) await dropImage(db, r, old);
  await routesHost()
    ?.hostRoute?.(siteId, true)
    .catch(() => undefined);
}

/** An image is removed from the server only when no other deploy row still names it (a promoted preview shares its image with production). The row forgets it either way. */
async function dropImage(db: Db, r: Runner, row: Row): Promise<void> {
  const image = str(row.image);
  db.run("UPDATE sites_deployment SET image = NULL WHERE id = ?", row.id);
  const other = db.all("SELECT id FROM sites_deployment WHERE image = ? AND id != ?", image, row.id) as Row[];
  if (other.length === 0) await r.removeImage(image).catch(() => undefined);
}

/** A preview is up: the one before it for the same branch is removed (its image too, unless something else uses it), and its address serves this container. */
async function switchPreview(
  db: Db,
  r: Runner,
  siteId: string,
  depId: string,
  containerId: string,
  preview: { branch: string; host: string },
): Promise<void> {
  const now = Date.now();
  db.run(
    "UPDATE sites_deployment SET url = ?, host = ?, removed_at = NULL, updated_at = ? WHERE id = ?",
    `https://${preview.host}`,
    preview.host,
    now,
    depId,
  );
  const older = db.all(
    "SELECT * FROM sites_deployment WHERE site_id = ? AND env = 'preview' AND branch = ? AND id != ? AND (container_id IS NOT NULL OR image IS NOT NULL) ORDER BY at DESC",
    siteId,
    preview.branch,
    depId,
  ) as Row[];
  for (const old of older) {
    if (!isNull(old.container_id)) {
      await r.remove(str(old.container_id)).catch(() => undefined);
      db.run("UPDATE sites_deployment SET container_id = NULL, host = NULL, url = NULL WHERE id = ?", old.id);
    }
    if (!isNull(old.image)) await dropImage(db, r, old);
  }
  await prunePreviews(db, r, siteId, depId);
  await routesHost()
    ?.hostRoute?.(siteId, true)
    .catch(() => undefined);
}

/** A site keeps its newest few previews (one per branch); an older one is removed with its container and its image, so branches that were never cleaned up cannot fill the disk. */
async function prunePreviews(db: Db, r: Runner, siteId: string, depId: string): Promise<void> {
  const rows = db.all(
    "SELECT * FROM sites_deployment WHERE site_id = ? AND env = 'preview' AND removed_at IS NULL AND (state = 'ready' OR id = ?) ORDER BY at DESC",
    siteId,
    depId,
  ) as Row[];
  const seen = new Set<string>();
  const now = Date.now();
  for (const row of rows) {
    const b = isNull(row.branch) ? "" : str(row.branch);
    if (!seen.has(b) && seen.size < PREVIEW_KEEP) {
      seen.add(b);
      continue;
    }
    if (!isNull(row.container_id)) await r.remove(str(row.container_id)).catch(() => undefined);
    db.run(
      "UPDATE sites_deployment SET container_id = NULL, host = NULL, url = NULL, removed_at = ?, updated_at = ? WHERE id = ?",
      now,
      now,
      row.id,
    );
    if (!isNull(row.image)) await dropImage(db, r, row);
  }
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
    const subnet = (parseJson<Record<string, unknown>>(r.settings, {})["network"] as { subnet?: string } | undefined)
      ?.subnet;
    if (typeof subnet === "string" && subnet) out.push(subnet);
  }
  return out;
}

// ---- capabilities

/** owner/name of a GitHub repo, as the source writes it; null for any other host. */
function githubRepo(raw: string): { owner: string; name: string } | null {
  const m = /^(?:(?:https?:\/\/)?(?:www\.)?github\.com\/)?([A-Za-z0-9_-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/i.exec(
    raw.trim(),
  );
  if (!m || /^\.+$/.test(m[1]!) || /^\.+$/.test(m[2]!)) return null;
  return { owner: m[1]!, name: m[2]! };
}

/**
 * What the host says about the production branch: protected (required reviews or restricted pushes), open, or unknown (anything that could not be read, a repo that is not on GitHub). Recorded on the site for the Gate, which holds a deploy by
 * anything but a person while the branch is not protected: anyone who can push to it can use the site's keys. Never throws.
 */
async function refreshProtection(ctx: Ctx, siteId: string, source: SourceSpec, token: string | null): Promise<string> {
  const gh = source.repo ? githubRepo(source.repo) : null;
  if (!gh) return "unknown";
  const api = `https://api.github.com/repos/${gh.owner}/${gh.name}`;
  const headers: Record<string, string> = { accept: "application/vnd.github+json", "user-agent": "vyre-sites" };
  if (token) headers["authorization"] = `Bearer ${token}`;
  let state = "unknown";
  let branch = source.branch ?? "";
  const get = async (url: string): Promise<{ status: number; body: unknown }> => {
    const r = await ctx.http(url, { headers });
    let body: unknown = null;
    try {
      body = JSON.parse(await r.text());
    } catch {
      body = null;
    }
    return { status: r.status, body };
  };
  try {
    if (!branch) {
      const repo = await get(api);
      if (repo.status === 200) branch = (repo.body as { default_branch?: string } | null)?.default_branch ?? "";
    }
    if (branch) {
      const name = encodeURIComponent(branch);
      // the rules that apply to the branch (rulesets) are readable with a token that can read the repo; the classic endpoint needs more. Rules first, the classic one for what they do not say.
      const rules = await get(`${api}/rules/branches/${name}`);
      const list = rules.status === 200 && Array.isArray(rules.body) ? (rules.body as Record<string, unknown>[]) : null;
      const bound = list?.some((r) => {
        if (r["type"] === "update") return true;
        const need = (r["parameters"] as { required_approving_review_count?: unknown } | undefined)
          ?.required_approving_review_count;
        return r["type"] === "pull_request" && typeof need === "number" && need >= 1;
      });
      if (bound) state = "protected";
      else {
        const classic = await get(`${api}/branches/${name}/protection`);
        if (classic.status === 200) {
          const b = (classic.body ?? {}) as Record<string, unknown>;
          const enforced = (b["enforce_admins"] as { enabled?: unknown } | undefined)?.enabled === true;
          // reviews or restricted pushes only count when they bind admins too: an admin who can push can use the keys
          state = (b["required_pull_request_reviews"] || b["restrictions"]) && enforced ? "protected" : "open";
        } else if (classic.status === 404) state = list ? "open" : "unknown";
      }
    }
  } catch {
    state = "unknown";
  }
  ctx.db.run(
    "UPDATE sites_site SET protection = ? WHERE id = ?",
    JSON.stringify({ state, branch, at: ctx.now() }),
    siteId,
  );
  return state;
}

async function sitesDeploy(ctx: Ctx, input: unknown): Promise<{ deployment: unknown }> {
  const o = rec(ctx, input);
  let site = mustSite(ctx, reqStr(ctx, o, "siteId"));
  if (site.kind === "artifact")
    fail(ctx, "validation.bad_input", "An artifact is published with artifact_publish, not deployed.");
  // a new source is kept once the deploy is going ahead: every refusal below comes before the write (ruling 90)
  const newSource = o.source !== undefined && o.source !== null ? JSON.stringify(cleanSource(ctx, o.source)) : null;
  if (newSource !== null) site = { ...site, source: newSource };
  const source = sourceOf(site);
  if (!source)
    fail(
      ctx,
      "validation.precondition_failed",
      "Give the site its source first: a GitHub repo, a folder or zip in Files, or a folder on this computer.",
    );
  const need = deployNeed();
  if (need) fail(ctx, "validation.precondition_failed", need);
  const siteId = str(site.id);
  const current = isNull(site.current_deployment) ? null : str(site.current_deployment);
  const token = source.tokenHandle ? await filled(ctx, source.tokenHandle, `${siteId}:token:${ctx.now()}`) : null;
  // a deploy by anything but a person (an agent, or a push) on a site that holds a production Vault key is only as good as what the Gate approved: no reading of its own, and the build refuses without one
  const strict =
    (ctx.principal.kind !== "person" || ctx.origin === "sites-push") &&
    !!many(
      ctx,
      "SELECT 1 FROM sites_env WHERE site_id = ? AND plain IS NULL AND vault_handle != '' AND scope != 'previews'",
      siteId,
    ).length;
  // uploaded files: the files the Gate judged for this call when it read them, else (a person's call, or a site with no key) what they are now, read as the caller; the build checks what it fetches against it
  const gateFp = takeGateFp(ctx.trace, siteId);
  const expectFp =
    source.folderId || source.fileId
      ? (gateFp ?? (strict ? null : await uploadFingerprint(source, (cap, inp) => ctx.call(cap as never, inp))))
      : null;
  if (optBool(ctx, o, "onlyIfChanged") === true && source.repo) {
    const last = one(
      ctx,
      "SELECT * FROM sites_deployment WHERE site_id = ? AND env = ? ORDER BY at DESC",
      siteId,
      "production",
    );
    // a push redeploys a site that was deployed; the first deploy is someone's own press
    if (!last) fail(ctx, "validation.precondition_failed", "It has not been deployed yet.");
    const head = await remoteHead(source.repo, source.branch, token);
    // a deploy of this commit that ended (also one a person canceled) is not started again by itself; one that is running is joined
    if (last && head && (last.commit_sha === head || last.state === "queued" || last.state === "building"))
      return { deployment: depRow(last, current) };
    if (!head) fail(ctx, "validation.precondition_failed", "The repo could not be read just now.");
  }
  if (newSource !== null) {
    ctx.db.run(
      "UPDATE sites_site SET source = ?, protection = NULL, updated_at = ? WHERE id = ?",
      newSource,
      ctx.now(),
      siteId,
    );
    site = mustSite(ctx, siteId);
  }
  // what the host says about the production branch, for the Gate (a person's deploy, or one a person approved, keeps it current)
  if (source.repo) {
    const seen = await refreshProtection(ctx, siteId, source, token);
    // the Gate's own look is only a pre-filter: this one is fresh. A deploy by an agent or a push where the branch is not protected now (or cannot be told) goes on only when a person approved it
    if (strict && githubRepo(source.repo) && seen !== "protected" && !wasApproved(ctx.trace, siteId))
      fail(
        ctx,
        "validation.precondition_failed",
        `Anyone who can push to ${source.branch || "the production branch"} can use this site's keys, and it is not protected on GitHub right now. Protect the branch, or ask a person to deploy.`,
      );
  }
  const busy = one(
    ctx,
    "SELECT * FROM sites_deployment WHERE site_id = ? AND env = ? AND state IN ('queued', 'building')",
    siteId,
    "production",
  );
  if (busy && (done.has(str(busy.id)) || cancels.has(str(busy.id)))) {
    // one deploy at a time per site: a second ask joins the one running, and waits for it when asked to
    if (optBool(ctx, o, "wait") === true)
      await Promise.race([done.get(str(busy.id)), new Promise((res) => setTimeout(res, WAIT_MAX_MS).unref?.())]);
    const now_ = mustSite(ctx, siteId);
    return {
      deployment: depRow(
        one(ctx, "SELECT * FROM sites_deployment WHERE id = ?", busy.id) as Row,
        isNull(now_.current_deployment) ? null : str(now_.current_deployment),
      ),
    };
  }
  const depId = nid(ctx, "dpl");
  const now = ctx.now();
  const by = ctx.actingFor ?? ctx.principal.id;
  // a deploy that was waiting for a person is answered by this one
  ctx.db.run(
    "DELETE FROM sites_push WHERE site_id = ? AND action = 'deploy' AND error LIKE 'Waiting for a person%'",
    siteId,
  );
  ctx.db.run(
    "INSERT INTO sites_deployment (id, site_id, env, state, url, branch, commit_sha, image, container_id, host, upstream, pr_number, log, created_by, at, updated_at, removed_at, merge_pending) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    depId,
    siteId,
    "production",
    "queued",
    null,
    source.branch ?? null,
    null,
    null,
    null,
    null,
    null,
    null,
    "[]",
    by,
    now,
    now,
    null,
    0,
  );
  // values are filled now, while this is the caller's own call: the Vault checks their access to each key
  const ac = new AbortController();
  const env = await envForNew(ctx, siteId, depId, "production", ac);
  if (env === null)
    return { deployment: depRow(one(ctx, "SELECT * FROM sites_deployment WHERE id = ?", depId) as Row, null) };
  const h = routesHost();
  const job: Job = {
    db: ctx.db,
    site,
    depId,
    source,
    env,
    token,
    limits: limitsOf(site),
    by,
    contained: h?.contained === true,
    call: (cap, inp) => ctx.call(cap as never, inp),
    publicNeedsPromote: ctx.principal.kind !== "person",
    signal: ac.signal,
    expectFp,
    strict,
  };
  const p = enqueue(() => runJob(job)).finally(() => {
    done.delete(depId);
    cancels.delete(depId);
  });
  done.set(depId, p);
  touchActivity(ctx.db, siteId, "site.deployed", now);
  if (optBool(ctx, o, "wait") === true)
    await Promise.race([p, new Promise((res) => setTimeout(res, WAIT_MAX_MS).unref?.())]);
  const row = one(ctx, "SELECT * FROM sites_deployment WHERE id = ?", depId) as Row;
  return {
    deployment: depRow(
      row,
      isNull(mustSite(ctx, siteId).current_deployment) ? null : str(mustSite(ctx, siteId).current_deployment),
    ),
  };
}

/** Stop the deploy that is running. The last good build keeps serving; a deploy that already changed the address stays live. */
async function sitesDeployCancel(ctx: Ctx, input: unknown): Promise<{ deployment: unknown }> {
  const o = rec(ctx, input);
  const site = mustSite(ctx, reqStr(ctx, o, "siteId"));
  const wanted = optStr(ctx, o, "deploymentId");
  const busy = many(
    ctx,
    "SELECT * FROM sites_deployment WHERE site_id = ? AND state IN ('queued', 'building')",
    site.id,
  )
    // without a deployment named it is the production deploy that runs; with one, any deploy of the site (a preview too)
    .filter((d) => (wanted === undefined ? d.env === "production" : d.id === wanted))
    .sort((a, b) => num(b.at) - num(a.at))[0];
  if (!busy) fail(ctx, "validation.precondition_failed", "No deploy is running.");
  const id = str(busy.id);
  if (switching.has(id))
    fail(
      ctx,
      "validation.precondition_failed",
      "It is going live now, so it cannot be canceled. Roll back once it is live if you do not want it.",
    );
  const running = done.get(id);
  cancels.get(id)?.abort();
  if (running) await Promise.race([running, new Promise((res) => setTimeout(res, CANCEL_WAIT_MS).unref?.())]);
  if (switching.has(id)) {
    // it reached the switch while the cancel waited: it goes live, and says so
    const after = mustSite(ctx, str(site.id));
    return {
      deployment: depRow(
        one(ctx, "SELECT * FROM sites_deployment WHERE id = ?", id) as Row,
        isNull(after.current_deployment) ? null : str(after.current_deployment),
      ),
    };
  }
  const row = one(ctx, "SELECT * FROM sites_deployment WHERE id = ?", id) as Row;
  if (row.state === "queued" || row.state === "building") {
    // a deploy this process is not running (the server restarted), or one still inside a step that cannot be cut off: it is closed here, and what it does next is thrown away
    const now = ctx.now();
    ctx.db.run(
      "UPDATE sites_deployment SET state = ?, problem = ?, fix = ?, steps = ?, finished_at = ?, updated_at = ? WHERE id = ? AND state IN ('queued', 'building')",
      "stopped",
      "Canceled.",
      "retry",
      isNull(row.steps) ? null : JSON.stringify(closedMeta(parseJson<StepMeta | null>(row.steps, null))),
      now,
      now,
      id,
    );
    // what the closed deploy started is taken away, so a container nothing routes to is not left behind
    if (!isNull(row.container_id)) {
      await runner()
        ?.remove(str(row.container_id))
        .catch(() => undefined);
      ctx.db.run("UPDATE sites_deployment SET container_id = NULL WHERE id = ? AND state = 'stopped'", id);
    }
  }
  const after = mustSite(ctx, str(site.id));
  return {
    deployment: depRow(
      one(ctx, "SELECT * FROM sites_deployment WHERE id = ?", id) as Row,
      isNull(after.current_deployment) ? null : str(after.current_deployment),
    ),
  };
}

/** What makes two sources the same app: the same repo (any branch) or the same folder, file or path, and the same app folder inside it. */
function sourceKey(s: SourceSpec): string {
  const what = s.repo
    ? `repo:${s.repo
        .trim()
        .replace(/^(https?:\/\/)?(www\.)?github\.com\//i, "")
        .replace(/\.git$/, "")
        .replace(/\/+$/, "")
        .toLowerCase()}`
    : s.folderId
      ? `folder:${s.folderId}`
      : s.fileId
        ? `file:${s.fileId}`
        : `path:${s.path ?? ""}`;
  return `${what}|${s.root ?? ""}`;
}
const sourceWords = (s: SourceSpec): string =>
  s.repo
    ? s.repo
        .trim()
        .replace(/^(https?:\/\/)?(www\.)?github\.com\//i, "")
        .replace(/\.git$/, "")
    : s.folderId
      ? "a folder in Files"
      : s.fileId
        ? "an upload in Files"
        : (s.path ?? "a folder");

/** Plain values that look like secrets are refused before anything is written, unless a person says they are plain. An agent cannot say that for itself: it keeps the value in the Vault, or asks a person. */
function checkPlain(ctx: Ctx, name: string, value: string, confirmed: boolean): void {
  if (!looksSecret(name, value)) return;
  if (!confirmed)
    fail(
      ctx,
      "validation.bad_input",
      `${name} looks like a secret. Keep it in the Vault (vaultHandle), or say it is plain on purpose (confirmPlain).`,
      { field: "entries.value", name },
    );
  if (ctx.principal.kind !== "person")
    fail(
      ctx,
      "permission.no_grant",
      `${name} looks like a secret, and an agent cannot say it is plain. Put it in the Vault and give its vaultHandle, or ask a person to add it on the site's Variables page.`,
      { field: "entries.confirmPlain", name },
    );
}

/** One call for an agent: create the site (or take the one named), set its env, add its databases, deploy, and say how it ended in words to hand on. A step that fails after the site exists comes back with the siteId, so calling again goes on from there. */
async function sitesShip(ctx: Ctx, input: unknown): Promise<Record<string, unknown>> {
  const o = rec(ctx, input);
  const wait = optBool(ctx, o, "wait") !== false;
  const named = optStr(ctx, o, "siteId");
  // what the caller passes as plain is checked now, before a site is made: a refusal later would leave a site behind
  if (Array.isArray(o["env"]))
    for (const e of o["env"] as { name?: unknown; value?: unknown; confirmPlain?: unknown }[])
      if (typeof e?.value === "string") checkPlain(ctx, String(e.name ?? ""), e.value, e.confirmPlain === true);
  let siteId: string;
  // a site this caller made by this name before is the one meant (a retry that has only the name finds it; it does not make a second)
  let reused = false;
  if (named === undefined) {
    const name = reqStr(ctx, o, "name");
    const mine = one(
      ctx,
      "SELECT id FROM sites_site WHERE deleted_at IS NULL AND source IS NOT NULL AND lower(name) = lower(?) AND owner = ? ORDER BY created_at DESC",
      name.trim(),
      ctx.actingFor ?? ctx.principal.id,
    );
    if (mine) {
      // a retry that has only the name, or the same source, goes on with that site; another app under the same name is not deployed over it
      if (o["source"] !== undefined) {
        const have = sourceOf(mustSite(ctx, str(mine.id)));
        const given = cleanSource(ctx, o["source"]);
        if (have && sourceKey(have) !== sourceKey(given))
          fail(
            ctx,
            "validation.precondition_failed",
            `A site named ${name.trim()} already deploys ${sourceWords(have)}. Pass its siteId to redeploy it, or give this one another name.`,
            { field: "name" },
          );
      }
      siteId = str(mine.id);
      reused = true;
    } else {
      if (o["source"] === undefined)
        fail(ctx, "validation.bad_input", "Say where the code is: a repo, a folder or zip in Files, or a path.", {
          field: "source",
        });
      const made = (await ctx.call("sites.create", {
        name,
        kind: optStr(ctx, o, "kind") ?? "app",
        source: o["source"],
        ...(o["access"] === undefined ? {} : { access: o["access"] }),
        ...(o["limits"] === undefined ? {} : { limits: o["limits"] }),
      } as never)) as { site: { siteId: string } };
      siteId = made.site.siteId;
    }
  } else siteId = str(mustSite(ctx, named).id);
  const stuck = (
    step: string,
    problem: string,
    fixKey?: Fix,
    failedStep: "setup" | "deploy" = "setup",
  ): Record<string, unknown> => ({
    ok: false,
    siteId,
    say:
      failedStep === "deploy"
        ? `It could not start the deploy: ${problem} Call sites_ship again with this siteId once that is fixed.`
        : `It stopped before the build, at ${step}: ${problem} Call sites_ship again with this siteId once that is fixed.`,
    failedStep,
    problem,
    ...(fixKey ? { fix: fixKey } : {}),
  });
  const words = (e: unknown): string => (e instanceof Error ? e.message : String(e));
  try {
    const entries = Array.isArray(o["env"])
      ? (o["env"] as { name: string; vaultHandle?: string; value?: string }[])
      : [];
    if (entries.length) {
      const have = (await ctx.call("sites.env_list", { siteId } as never)) as {
        entries: { name: string; vaultName: string; kind: string; value?: string; scope: string }[];
      };
      const keep = have.entries
        .filter((e) => !entries.some((n) => n.name === e.name))
        .map((e) => ({
          name: e.name,
          scope: e.scope,
          ...(e.kind === "plain" ? { value: e.value ?? "", confirmPlain: true } : { vaultHandle: e.vaultName }),
        }));
      await ctx.call("sites.env_set", { siteId, entries: [...keep, ...entries] } as never);
    }
  } catch (e) {
    return stuck("the env vars", words(e), "set_env");
  }
  try {
    const wanted = Array.isArray(o["addons"]) ? (o["addons"] as string[]) : [];
    if (wanted.length) {
      const site = (await ctx.call("sites.get", { siteId } as never)) as { site: { addons?: { kind: string }[] } };
      for (const kind of new Set(wanted))
        if (!site.site.addons?.some((a) => a.kind === kind))
          await ctx.call("sites.addon_add", { siteId, kind, idempotencyKey: `ship:${siteId}:${kind}` } as never);
    }
  } catch (e) {
    return stuck("the database", words(e));
  }
  let deployment: Record<string, unknown>;
  try {
    const out = (await ctx.call("sites.deploy", {
      siteId,
      wait,
      ...((named !== undefined || reused) && o["source"] !== undefined ? { source: o["source"] } : {}),
    } as never)) as { deployment: Record<string, unknown> };
    deployment = out.deployment;
  } catch (e) {
    return stuck("the deploy", words(e), undefined, "deploy");
  }
  const site = (await ctx.call("sites.get", { siteId } as never)) as { site: { url?: string; live?: boolean } };
  const state = str(deployment.state);
  if (state === "ready") {
    const address = site.site.live ? site.site.url : undefined;
    return {
      ok: true,
      siteId,
      ...(address ? { address } : {}),
      say: address
        ? `It is live at ${address}.`
        : "It is built and running. It is not public yet: public access waits for the person's yes, so ask for sites_promote.",
      deployment,
    };
  }
  if (state === "queued" || state === "building")
    return {
      ok: true,
      siteId,
      say: "The deploy has started. Read sites_deployments or sites_logs with build to follow it.",
      deployment,
    };
  const steps = (deployment.steps as { key: string; state: string }[] | undefined) ?? [];
  const failedStep = steps.find((s) => s.state === "failed")?.key ?? "build";
  const problem = typeof deployment.problem === "string" ? deployment.problem : "The deploy did not finish.";
  const fixKey = typeof deployment.fix === "string" ? (deployment.fix as Fix) : undefined;
  return {
    ok: false,
    siteId,
    say: `It stopped at ${failedStep}: ${problem}${fixKey ? ` The fix is ${fixKey}.` : ""} The log is sites_logs with build; fix it and call sites_ship again with this siteId.`,
    failedStep,
    problem,
    ...(fixKey ? { fix: fixKey } : {}),
    deployment,
  };
}

// ---- previews: a branch of the repo built and run at its own address, behind sign-in, and promoted to production without a rebuild

const fnv = (s: string): string => {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return h.toString(16).padStart(8, "0");
};

/** A name that is safe in an address: lowercase letters, digits and dashes, at most 63 characters, always ending in --<site name>. A branch that had to be changed to fit gets a hash of 8 hex, so two branches never share an address; when the whole thing is too long the hash covers the site name too, so two sites never do. */
export function previewLabel(slug: string, branch: string): string {
  const base =
    branch
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "branch";
  const whole = base === branch ? `${base}--${slug}` : `${base}-${fnv(branch)}--${slug}`;
  if (whole.length <= 63) return whole;
  const head = `${base.slice(0, 12).replace(/-+$/g, "") || "b"}-${fnv(`${slug}\n${branch}`)}--`;
  return (head + slug).slice(0, 63).replace(/-+$/g, "");
}

function previewHostFor(ctx: Ctx, site: Row, branch: string): string {
  const domain = routesHost()?.sitesDomain?.();
  if (!domain || isNull(site.slug))
    fail(
      ctx,
      "validation.precondition_failed",
      "Previews need this Space to have a sites domain. Set one in Settings.",
    );
  let label = previewLabel(str(site.slug), branch);
  // never an address that is some site's own name
  if (one(ctx, "SELECT id FROM sites_site WHERE slug = ? AND deleted_at IS NULL", label))
    label = `${label.slice(0, 60)}-p`;
  // nor one another site's preview already has
  let n = 2;
  while (
    one(
      ctx,
      "SELECT id FROM sites_deployment WHERE host = ? AND site_id != ? AND removed_at IS NULL",
      `${label}.${domain}`,
      site.id,
    )
  )
    label = `${label.slice(0, 58)}-${n++}`;
  return `${label}.${domain}`;
}

const previewRows = (ctx: Ctx, siteId: string): Row[] =>
  many(ctx, "SELECT * FROM sites_deployment WHERE site_id = ? AND env = 'preview' AND removed_at IS NULL", siteId).sort(
    (a, b) => num(b.at) - num(a.at),
  );

async function sitesPreviews(ctx: Ctx, input: unknown): Promise<{ previews: unknown[] }> {
  const site = mustSite(ctx, reqStr(ctx, rec(ctx, input), "siteId"));
  const seen = new Set<string>();
  const latest: Row[] = [];
  for (const r of previewRows(ctx, str(site.id))) {
    const b = isNull(r.branch) ? "" : str(r.branch);
    if (seen.has(b)) continue;
    seen.add(b);
    latest.push(r);
  }
  return { previews: latest.map((r) => depRow(r, null)) };
}

async function sitesPreviewRebuild(ctx: Ctx, input: unknown): Promise<{ deployment: unknown }> {
  const o = rec(ctx, input);
  const site = mustSite(ctx, reqStr(ctx, o, "siteId"));
  const branch = cleanBranch(reqStr(ctx, o, "branch"));
  if (!branch)
    fail(ctx, "validation.bad_input", "A branch name uses letters, digits and . _ / -.", { field: "branch" });
  const source = sourceOf(site);
  if (!source?.repo)
    fail(ctx, "validation.precondition_failed", "A preview is a branch of a GitHub repo. This site has no repo.");
  const need = deployNeed();
  if (need) fail(ctx, "validation.precondition_failed", need);
  const siteId = str(site.id);
  const host = previewHostFor(ctx, site, branch);
  const busy = many(
    ctx,
    "SELECT * FROM sites_deployment WHERE site_id = ? AND env = 'preview' AND branch = ? AND state IN ('queued', 'building')",
    siteId,
    branch,
  )[0];
  if (busy && (done.has(str(busy.id)) || cancels.has(str(busy.id)))) return { deployment: depRow(busy, null) };
  const depId = nid(ctx, "dpl");
  const now = ctx.now();
  const by = ctx.actingFor ?? ctx.principal.id;
  ctx.db.run(
    "INSERT INTO sites_deployment (id, site_id, env, state, url, branch, commit_sha, image, container_id, host, upstream, pr_number, log, created_by, at, updated_at, removed_at, merge_pending) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    depId,
    siteId,
    "preview",
    "queued",
    null,
    branch,
    null,
    null,
    null,
    null,
    null,
    null,
    "[]",
    by,
    now,
    now,
    null,
    0,
  );
  const ac = new AbortController();
  // registered before the first await, so a second call sees this one and a cancel is recorded; a token that cannot be filled ends the row
  cancels.set(depId, ac);
  let token: string | null = null;
  try {
    token = source.tokenHandle ? await filled(ctx, source.tokenHandle, `${siteId}:token:${ctx.now()}`) : null;
  } catch (e) {
    cancels.delete(depId);
    finish(ctx.db, depId, "failed", {
      problem: e instanceof Error ? e.message.slice(0, 200) : "The token could not be read.",
      fix: "connect_repo",
    });
    throw e;
  }
  const env = await envForNew(ctx, siteId, depId, "preview", ac, branch);
  if (env === null)
    return { deployment: depRow(one(ctx, "SELECT * FROM sites_deployment WHERE id = ?", depId) as Row, null) };
  const job: Job = {
    db: ctx.db,
    site,
    depId,
    source: { ...source, branch },
    env,
    token,
    limits: limitsOf(site),
    by,
    contained: routesHost()?.contained === true,
    call: (cap, inp) => ctx.call(cap as never, inp),
    publicNeedsPromote: true,
    signal: ac.signal,
    preview: { branch, host },
  };
  const p = enqueue(() => runJob(job)).finally(() => {
    done.delete(depId);
    cancels.delete(depId);
  });
  done.set(depId, p);
  if (optBool(ctx, o, "wait") === true)
    await Promise.race([p, new Promise((res) => setTimeout(res, WAIT_MAX_MS).unref?.())]);
  return { deployment: depRow(one(ctx, "SELECT * FROM sites_deployment WHERE id = ?", depId) as Row, null) };
}

async function sitesPreviewRemove(ctx: Ctx, input: unknown): Promise<{ removed: boolean }> {
  const o = rec(ctx, input);
  const site = mustSite(ctx, reqStr(ctx, o, "siteId"));
  const branch = cleanBranch(reqStr(ctx, o, "branch"));
  const siteId = str(site.id);
  const open = (): Row[] =>
    many(
      ctx,
      "SELECT * FROM sites_deployment WHERE site_id = ? AND env = 'preview' AND branch = ? AND removed_at IS NULL",
      siteId,
      branch ?? "",
    );
  if (open().length === 0) return { removed: false };
  // one that is still building is canceled first, so it cannot start a container after this; one that is going live is waited for
  for (const row of open()) {
    const id = str(row.id);
    if (row.state !== "queued" && row.state !== "building") continue;
    if (switching.has(id)) {
      await done.get(id);
      continue;
    }
    cancels.get(id)?.abort();
    const running = done.get(id);
    if (running) await Promise.race([running, new Promise((res) => setTimeout(res, CANCEL_WAIT_MS).unref?.())]);
    // closed here when its step could not be cut off: the state moves with the removal, so nothing reads it half built
    finish(ctx.db, id, "stopped", { problem: "Removed.", fix: "retry" });
  }
  const r = runner();
  const now = ctx.now();
  for (const row of open()) {
    if (r && !isNull(row.container_id)) await r.remove(str(row.container_id)).catch(() => undefined);
    ctx.db.run(
      "UPDATE sites_deployment SET container_id = NULL, host = NULL, url = NULL, removed_at = ?, updated_at = ? WHERE id = ?",
      now,
      now,
      row.id,
    );
    if (r && !isNull(row.image)) await dropImage(ctx.db, r, row);
  }
  await routesHost()
    ?.hostRoute?.(siteId, true)
    .catch(() => undefined);
  return { removed: true };
}

/** Serve a preview's build as production without building it again: its image starts with the production variables, and goes through the same check and switch as any deploy. */
async function sitesPreviewPromote(ctx: Ctx, input: unknown): Promise<{ deployment: unknown }> {
  const o = rec(ctx, input);
  const site = mustSite(ctx, reqStr(ctx, o, "siteId"));
  const branch = cleanBranch(reqStr(ctx, o, "branch"));
  const r = runner();
  if (!r) fail(ctx, "validation.precondition_failed", deployNeed() ?? "No server can run it.");
  const siteId = str(site.id);
  const prev = previewRows(ctx, siteId).find((d) => d.branch === branch && d.state === "ready");
  if (!prev || isNull(prev.image))
    fail(ctx, "validation.precondition_failed", "That preview has no finished build to promote. Rebuild it first.");
  if (!(await r.imageExists(str(prev.image))))
    fail(ctx, "validation.precondition_failed", "That preview's build is gone from the server. Rebuild it first.");
  const busy = one(
    ctx,
    "SELECT * FROM sites_deployment WHERE site_id = ? AND env = 'production' AND state IN ('queued', 'building')",
    siteId,
  );
  if (busy && (done.has(str(busy.id)) || cancels.has(str(busy.id))))
    fail(ctx, "validation.precondition_failed", "A deploy is running. Wait for it, or cancel it, then promote.");
  const depId = nid(ctx, "dpl");
  const now = ctx.now();
  const by = ctx.actingFor ?? ctx.principal.id;
  ctx.db.run(
    "INSERT INTO sites_deployment (id, site_id, env, state, url, branch, commit_sha, message, image, container_id, host, upstream, pr_number, log, created_by, at, updated_at, removed_at, merge_pending, plan, port, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    depId,
    siteId,
    "production",
    "queued",
    null,
    prev.branch,
    prev.commit_sha,
    prev.message ?? null,
    prev.image,
    null,
    null,
    null,
    null,
    "[]",
    by,
    now,
    now,
    null,
    0,
    prev.plan ?? null,
    prev.port ?? null,
    `Promoted from the preview of ${branch}. Not built again.`,
  );
  ctx.db.run(
    "INSERT INTO sites_promotion (production_id, site_id, source_id, pr_number, merge_sha, promoted_by, at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    depId,
    siteId,
    prev.id,
    null,
    prev.commit_sha ?? null,
    by,
    now,
  );
  ctx.db.run(
    "UPDATE sites_deployment SET built_from = ? WHERE id = ?",
    isNull(prev.built_from) ? null : str(prev.built_from),
    depId,
  );
  const ac = new AbortController();
  const env = await envForNew(ctx, siteId, depId, "production", ac);
  if (env === null)
    return { deployment: depRow(one(ctx, "SELECT * FROM sites_deployment WHERE id = ?", depId) as Row, null) };
  const p = enqueue(() =>
    runPromote({
      db: ctx.db,
      site,
      depId,
      image: str(prev.image),
      port: num(prev.port) || parseJson<{ port?: number }>(prev.plan, {}).port || 3000,
      env,
      limits: limitsOf(site),
      by,
      publicNeedsPromote: ctx.principal.kind !== "person",
      signal: ac.signal,
    }),
  ).finally(() => {
    done.delete(depId);
    cancels.delete(depId);
  });
  done.set(depId, p);
  if (optBool(ctx, o, "wait") === true)
    await Promise.race([p, new Promise((res) => setTimeout(res, WAIT_MAX_MS).unref?.())]);
  const after = mustSite(ctx, siteId);
  return {
    deployment: depRow(
      one(ctx, "SELECT * FROM sites_deployment WHERE id = ?", depId) as Row,
      isNull(after.current_deployment) ? null : str(after.current_deployment),
    ),
  };
}

/** The run of a promoted preview: fetch and build never happen (they say so), the image starts with the production variables, is checked, and the address switches. A cancel before the switch leaves what was serving. */
async function runPromote(j: {
  db: Db;
  site: Row;
  depId: string;
  image: string;
  port: number;
  env: Record<string, string>;
  limits: Limits;
  by: string;
  publicNeedsPromote: boolean;
  signal: AbortSignal;
}): Promise<void> {
  const r = runner();
  const siteId = str(j.site.id);
  const log = new DeployLog(j.db, j.depId, { steps: true });
  const say = (line: string): void => log.add(`==> ${line}`);
  const end = (state: "ready" | "failed" | "stopped", fields: { problem?: string; fix?: Fix; note?: string }): void => {
    log.settle(state === "ready");
    finish(j.db, j.depId, state, fields);
  };
  let startedId: string | null = null;
  let switched = false;
  try {
    stopIfCanceled(j.signal);
    if (!r) {
      end("failed", { problem: deployNeed() ?? "No server can run it.", fix: "retry" });
      return;
    }
    if (!begin(j.db, j.depId)) return;
    log.skip("fetch", "build");
    say("Promoting the build of the preview. It is not built again.");
    await keepNetwork(j.db, r, siteId);
    log.begin("start");
    say(`Starting it with ${j.limits.cpus} CPU and ${j.limits.memoryMb} MB, with the production variables`);
    const started = await r.run({
      siteId,
      deploymentId: j.depId,
      image: j.image,
      port: j.port,
      env: j.env,
      limits: j.limits,
    });
    startedId = started.containerId;
    j.db.run("UPDATE sites_deployment SET container_id = ? WHERE id = ?", started.containerId, j.depId);
    stopIfCanceled(j.signal);
    log.begin("check");
    const ready = await waitReady(r, started.containerId, j.port, "/", log, j.signal);
    stopIfCanceled(j.signal);
    if (!ready.ok) {
      const d = diagnose(ready.lines, {
        stage: "start",
        port: j.port,
        oom: ready.oom,
        memoryMb: j.limits.memoryMb,
        hasPostgres: "DATABASE_URL" in j.env,
        hasRedis: "REDIS_URL" in j.env,
        envSet: new Set(Object.keys(j.env)),
      });
      await r.remove(started.containerId).catch(() => undefined);
      j.db.run("UPDATE sites_deployment SET container_id = NULL WHERE id = ?", j.depId);
      log.add(d.problem);
      end("failed", d);
      return;
    }
    stopIfClosed(j.db, j.depId);
    switched = true;
    switching.add(j.depId);
    await switchTo(j.db, r, siteId, j.depId, started.containerId, j.port, j.by, j.publicNeedsPromote);
    say("Live");
    end("ready", {});
  } catch (e) {
    if (switched) {
      await afterSwitchError(j.db, r, siteId, j.depId, startedId, false, e, log, end);
      return;
    }
    if (e instanceof Canceled || j.signal.aborted) {
      if (startedId && r) {
        await r.remove(startedId).catch(() => undefined);
        j.db.run("UPDATE sites_deployment SET container_id = NULL WHERE id = ?", j.depId);
      }
      say("Canceled");
      end("stopped", { problem: "Canceled.", fix: "retry" });
      return;
    }
    const why = e instanceof Error ? e.message : String(e);
    log.add(why);
    end("failed", { problem: `The deploy stopped: ${why.slice(0, 200)}`, fix: "retry" });
  } finally {
    switching.delete(j.depId);
    log.close();
  }
}

async function sitesDeployments(
  ctx: Ctx,
  input: unknown,
): Promise<{ deployments: unknown[]; next?: string; total: number }> {
  const o = rec(ctx, input);
  const site = mustSite(ctx, reqStr(ctx, o, "siteId"));
  const limit = Math.min(typeof o.limit === "number" ? o.limit : 50, 500);
  const offset = typeof o.cursor === "string" && /^[0-9]{1,9}$/.test(o.cursor) ? Number(o.cursor) : 0;
  const rows = many(ctx, "SELECT * FROM sites_deployment WHERE site_id = ? AND env = ?", site.id, "production").sort(
    (a, b) => num(b.at) - num(a.at) || str(b.id).localeCompare(str(a.id)),
  );
  const current = isNull(site.current_deployment) ? null : str(site.current_deployment);
  const out: { deployments: unknown[]; next?: string; total: number } = {
    deployments: rows.slice(offset, offset + limit).map((r) => depRow(r, current)),
    total: rows.length,
  };
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
  const done_ = many(
    ctx,
    "SELECT * FROM sites_deployment WHERE site_id = ? AND env = ? AND image IS NOT NULL AND finished_at IS NOT NULL",
    siteId,
    "production",
  ).sort((a, b) => num(b.at) - num(a.at));
  const target =
    wanted !== undefined
      ? done_.find((d) => d.id === wanted)
      : done_.find(
          (d) =>
            d.id !== current &&
            d.state === "ready" &&
            num(d.at) < num(done_.find((x) => x.id === current)?.at ?? Number.MAX_SAFE_INTEGER),
        );
  if (!target)
    fail(
      ctx,
      "validation.precondition_failed",
      wanted
        ? "That build is no longer kept on the server. Deploy its commit again instead."
        : "There is no earlier build to go back to.",
    );
  if (target.id === current) return { deployment: depRow(target, current) };
  if (!(await r.imageExists(str(target.image))))
    fail(
      ctx,
      "validation.precondition_failed",
      "That build's image is gone from the server. Deploy its commit again instead.",
    );
  const plan = parseJson<{ port?: number }>(target.plan, {});
  const port = num(target.port) || plan.port || 3000;
  const env = await envOf(ctx, siteId, str(target.id));
  const started = await r.run({
    siteId,
    deploymentId: `${str(target.id)}r${ctx.now().toString(36)}`,
    image: str(target.image),
    port,
    env,
    limits: limitsOf(site),
  });
  const log = new DeployLog(ctx.db, str(target.id), {
    lines: parseJson<string[]>(target.log, []),
    meta: parseJson<StepMeta | null>(target.steps, null),
  });
  log.add(`==> Rolling back to this build (${ctx.now()})`);
  const ready = await waitReady(r, started.containerId, port, "/", log);
  log.close();
  if (!ready.ok) {
    await r.remove(started.containerId).catch(() => undefined);
    const d = diagnose(ready.lines, { stage: "start", port, oom: ready.oom, memoryMb: limitsOf(site).memoryMb });
    fail(ctx, "validation.precondition_failed", `That build did not come back up: ${d.problem}`);
  }
  await switchTo(
    ctx.db,
    r,
    siteId,
    str(target.id),
    started.containerId,
    port,
    ctx.actingFor ?? ctx.principal.id,
    ctx.principal.kind !== "person",
  );
  ctx.db.run(
    "UPDATE sites_deployment SET container_id = ?, state = ? WHERE id = ?",
    started.containerId,
    "ready",
    target.id,
  );
  ctx.emit("site.rolled_back", `site/${siteId}`, { siteId, toDeploymentId: str(target.id) });
  return {
    deployment: depRow(one(ctx, "SELECT * FROM sites_deployment WHERE id = ?", target.id) as Row, str(target.id)),
  };
}

async function sitesEnvSet(ctx: Ctx, input: unknown): Promise<{ ok: boolean }> {
  const o = rec(ctx, input);
  const site = mustSite(ctx, reqStr(ctx, o, "siteId"));
  if (!Array.isArray(o.entries)) fail(ctx, "validation.bad_input", "The entries are not valid.", { field: "entries" });
  if (o.entries.length > 200)
    fail(ctx, "validation.too_large", "A site takes at most 200 env vars.", { field: "entries" });
  const seen = new Set<string>();
  const next: { name: string; handle: string; plain: string | null; scope: string }[] = [];
  for (const e of o.entries) {
    const row = rec(ctx, e);
    const name = reqStr(ctx, row, "name").trim();
    const handle = (optStr(ctx, row, "vaultHandle") ?? "").trim();
    const value = row["value"];
    if (value !== undefined && typeof value !== "string")
      fail(ctx, "validation.bad_input", `The value of ${name} is not text.`, { field: "entries.value", name });
    // a variable applies to production unless a person says otherwise: a preview runs any branch's code, so it only gets what was scoped to it
    const scope = optStr(ctx, row, "scope") ?? "production";
    if (!ENV_SCOPES.has(scope))
      fail(ctx, "validation.bad_input", "A scope is all, production or previews.", { field: "entries.scope", name });
    if (!ENV_NAME.test(name))
      fail(
        ctx,
        "validation.bad_input",
        "An env var name uses letters, digits and underscores, and does not start with a digit.",
        { field: "entries.name", name },
      );
    if (RESERVED_ENV.has(name))
      fail(ctx, "validation.bad_input", `${name} is set by Vyre.`, { field: "entries.name", name });
    if ((handle === "") === (value === undefined))
      fail(ctx, "validation.bad_input", `${name} takes a Vault key or a plain value, one of the two.`, {
        field: "entries.vaultHandle",
        name,
      });
    if (value !== undefined) checkPlain(ctx, name, value, row["confirmPlain"] === true);
    if (value !== undefined && value.length > 8192)
      fail(ctx, "validation.too_large", `The value of ${name} is over 8 KB. Put it in the Vault as a secret.`, {
        field: "entries.value",
        name,
      });
    if (handle !== "" && !HANDLE.test(handle))
      fail(ctx, "validation.bad_input", "A Vault key is written as #Name or #Name.field.", {
        field: "entries.vaultHandle",
        name,
      });
    if (seen.has(name)) fail(ctx, "validation.duplicate", `${name} is listed twice.`, { name });
    seen.add(name);
    next.push({ name, handle, plain: typeof value === "string" ? value : null, scope });
  }
  // the caller must be able to use each key now, or a deploy would fail later for a reason they cannot see
  for (const e of next)
    if (e.handle !== "") await filled(ctx, e.handle, `check:${str(site.id)}:${e.name}:${ctx.now()}`);
  ctx.db.run("DELETE FROM sites_env WHERE site_id = ?", site.id);
  for (const e of next)
    ctx.db.run(
      "INSERT INTO sites_env (site_id, name, vault_handle, injected, plain, scope) VALUES (?, ?, ?, ?, ?, ?)",
      site.id,
      e.name,
      e.handle,
      0,
      e.plain,
      e.scope,
    );
  ctx.db.run("UPDATE sites_site SET updated_at = ? WHERE id = ?", ctx.now(), site.id);
  return { ok: true };
}

async function sitesEnvList(ctx: Ctx, input: unknown): Promise<{ entries: unknown[]; wanted: string[] }> {
  const site = mustSite(ctx, reqStr(ctx, rec(ctx, input), "siteId"));
  const rows = many(ctx, "SELECT * FROM sites_env WHERE site_id = ?", site.id).sort((a, b) =>
    str(a.name).localeCompare(str(b.name)),
  );
  const current = isNull(site.current_deployment)
    ? null
    : one(ctx, "SELECT * FROM sites_deployment WHERE id = ?", site.current_deployment);
  const injected = current ? num(current.at) : 0;
  const last = one(
    ctx,
    "SELECT * FROM sites_deployment WHERE site_id = ? AND plan IS NOT NULL ORDER BY at DESC",
    site.id,
  );
  const plan = parseJson<{ env?: string[]; needs?: string[] }>(last?.plan, {});
  const have = new Set([...rows.map((r) => str(r.name)), ...Object.keys(addonNames(ctx, str(site.id)))]);
  const wanted = (plan.env ?? []).filter((n) => !have.has(n) && !RESERVED_ENV.has(n) && n !== "NODE_ENV");
  return {
    entries: rows.map((r) => ({
      name: str(r.name),
      vaultName: str(r.vault_handle),
      injected: injected > 0,
      kind: isNull(r.plain) ? "secret" : "plain",
      ...(isNull(r.plain) ? {} : { value: str(r.plain) }),
      scope: isNull(r.scope) ? "production" : str(r.scope),
    })),
    wanted,
  };
}

function addonNames(ctx: Ctx, siteId: string): Record<string, true> {
  const out: Record<string, true> = {};
  for (const a of many(ctx, "SELECT * FROM sites_addon WHERE site_id = ?", siteId)) {
    if (a.kind === "postgres")
      for (const n of ["DATABASE_URL", "PGHOST", "PGPORT", "PGUSER", "PGPASSWORD", "PGDATABASE"]) out[n] = true;
    if (a.kind === "redis") out.REDIS_URL = true;
  }
  return out;
}

const randomPassword = (): string =>
  Array.from(globalThis.crypto.getRandomValues(new Uint8Array(24)), (b) => b.toString(16).padStart(2, "0")).join("");

async function sitesAddonAdd(ctx: Ctx, input: unknown): Promise<{ addon: unknown }> {
  const o = rec(ctx, input);
  const site = mustSite(ctx, reqStr(ctx, o, "siteId"));
  const kind = reqStr(ctx, o, "kind") as AddonKind;
  if (kind !== "postgres" && kind !== "redis")
    fail(ctx, "validation.bad_input", "Postgres or Redis.", { field: "kind" });
  const r = runner();
  if (!r) fail(ctx, "validation.precondition_failed", deployNeed() ?? "No server can run it.");
  const siteId = str(site.id);
  const envName = kind === "postgres" ? "DATABASE_URL" : "REDIS_URL";
  const had = one(ctx, "SELECT * FROM sites_addon WHERE site_id = ? AND kind = ?", siteId, kind);
  const password = had ? await secretOf(ctx, had) : randomPassword();
  await keepNetwork(ctx.db, r, siteId);
  if (!had)
    ctx.db.run(
      "INSERT INTO sites_addon (site_id, kind, container_id, state, env_name, secret, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      siteId,
      kind,
      null,
      "starting",
      envName,
      JSON.stringify(ctx.seal.seal(new TextEncoder().encode(password), `site-addon:${siteId}:${kind}`)),
      null,
      ctx.now(),
    );
  try {
    const made = await r.addon({ siteId, kind, password });
    // ready when it takes a connection
    let ok = false;
    for (let i = 0; i < 60 && !ok; i++) {
      const probe =
        kind === "postgres"
          ? await r.exec(made.containerId, ["pg_isready", "-U", "app", "-d", "app", "-h", "127.0.0.1"], {})
          : await r.exec(made.containerId, ["redis-cli", "-a", password, "--no-auth-warning", "ping"], {});
      ok = probe.code === 0 && (kind === "postgres" || /PONG/.test(probe.out));
      if (!ok) await new Promise((res) => setTimeout(res, 500));
    }
    ctx.db.run(
      "UPDATE sites_addon SET container_id = ?, state = ?, detail = ? WHERE site_id = ? AND kind = ?",
      made.containerId,
      ok ? "ready" : "failed",
      ok ? null : "It started but does not take connections yet.",
      siteId,
      kind,
    );
  } catch (e) {
    ctx.db.run(
      "UPDATE sites_addon SET state = ?, detail = ? WHERE site_id = ? AND kind = ?",
      "failed",
      (e instanceof Error ? e.message : String(e)).slice(0, 200),
      siteId,
      kind,
    );
  }
  const row = one(ctx, "SELECT * FROM sites_addon WHERE site_id = ? AND kind = ?", siteId, kind) as Row;
  ctx.db.run("UPDATE sites_site SET updated_at = ? WHERE id = ?", ctx.now(), siteId);
  return {
    addon: { kind, state: str(row.state), envName, ...(isNull(row.detail) ? {} : { detail: str(row.detail) }) },
  };
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
  if ((fileId === undefined) === (fromHandle === undefined))
    fail(
      ctx,
      "validation.bad_input",
      "Give a pg_dump file from Files, or the Vault key that holds the old connection string.",
      { field: "fileId" },
    );
  const r = runner();
  if (!r) fail(ctx, "validation.precondition_failed", deployNeed() ?? "No server can run it.");
  const pg = one(ctx, "SELECT * FROM sites_addon WHERE site_id = ? AND kind = ?", site.id, "postgres");
  if (!pg || isNull(pg.container_id) || pg.state !== "ready")
    fail(ctx, "validation.precondition_failed", "Add the site's Postgres first, then copy the data into it.");
  const container = str(pg.container_id);
  const local = { PGPASSWORD: await secretOf(ctx, pg), PGUSER: "app", PGDATABASE: "app", PGHOST: "127.0.0.1" };
  let res: { code: number; out: string };
  if (fromHandle !== undefined) {
    if (!HANDLE.test(fromHandle))
      fail(ctx, "validation.bad_input", "A Vault key is written as #Name.", { field: "fromHandle" });
    const from = await filled(ctx, fromHandle, `${str(site.id)}:import:${ctx.now()}`);
    if (!/^postgres(ql)?:\/\//.test(from))
      fail(ctx, "validation.bad_input", "That Vault key does not hold a postgres:// connection string.", {
        field: "fromHandle",
      });
    // pg_dump runs in the site's own Postgres container, which has the client; the old address goes in through the exec's environment only
    res = await r.exec(
      container,
      ["sh", "-c", 'pg_dump --no-owner --no-acl --clean --if-exists "$VYRE_FROM" | psql -v ON_ERROR_STOP=0 -q'],
      { ...local, VYRE_FROM: from },
    );
  } else {
    const got = (await ctx.call("files.read", { fileId, as: "base64" })) as { base64?: string };
    if (typeof got.base64 !== "string") fail(ctx, "validation.precondition_failed", "That file could not be read.");
    const bytes = new Uint8Array(Buffer.from(got.base64, "base64"));
    await r.put(container, "/tmp", "vyre-import.dump", bytes);
    // a custom-format dump starts with PGDMP and goes through pg_restore; a plain one is SQL
    const custom = Buffer.from(bytes.subarray(0, 5)).toString("latin1") === "PGDMP";
    res = await r.exec(
      container,
      [
        "sh",
        "-c",
        custom
          ? "pg_restore --no-owner --no-acl --clean --if-exists -d app /tmp/vyre-import.dump; s=$?; rm -f /tmp/vyre-import.dump; exit $s"
          : "psql -v ON_ERROR_STOP=0 -q -f /tmp/vyre-import.dump; s=$?; rm -f /tmp/vyre-import.dump; exit $s",
      ],
      local,
    );
  }
  const tables = await r.exec(
    container,
    [
      "psql",
      "-tAc",
      "select count(*) from information_schema.tables where table_schema not in ('pg_catalog','information_schema')",
    ],
    local,
  );
  const n = Number(tables.out.trim().split("\n").pop()) || 0;
  const errors = res.out.split("\n").filter((l) => /ERROR/.test(l));
  const ok = n > 0 && (res.code === 0 || errors.length < 5);
  return {
    ok,
    detail: ok
      ? `Copied. The database has ${n} table${n === 1 ? "" : "s"}${errors.length ? `; ${errors.length} line${errors.length === 1 ? "" : "s"} did not apply (often roles or extensions that are not needed)` : ""}.`
      : `It did not copy: ${(errors[0] ?? res.out.trim().split("\n").pop() ?? "no detail").slice(0, 200)}`,
  };
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
    fetched = await fetchSource(source, {
      call: (c, i) => ctx.call(c as never, i),
      token: async () => token,
      contained: routesHost()?.contained === true,
      ...(routesHost()?.tmp ? { tmp: routesHost()!.tmp! } : {}),
    });
    const p = await sitePlan(fetched.dir);
    return {
      kind: p.kind,
      note: p.note,
      ...(p.build ? { build: p.build } : {}),
      ...(p.start ? { start: p.start } : {}),
      port: p.port,
      needs: p.needs,
      env: p.env,
      from: p.from,
    };
  } catch (e) {
    return fail(ctx, "validation.precondition_failed", e instanceof Error ? e.message : String(e));
  } finally {
    fetched?.cleanup();
  }
}

// a password is kept as PBKDF2-SHA256 of it with a salt of its own; Web Crypto, so nothing here needs node:crypto
const ITER = 210_000;
const toHex = (b: ArrayBuffer | Uint8Array): string =>
  Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");
async function pbkdf2(password: string, salt: Uint8Array, iter: number): Promise<string> {
  const key = await globalThis.crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  return toHex(
    await globalThis.crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: iter }, key, 256),
  );
}
export async function hashPassword(password: string): Promise<string> {
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ITER}$${toHex(salt)}$${await pbkdf2(password, salt, ITER)}`;
}
export async function checkPassword(password: string, stored: string): Promise<boolean> {
  const [kind, iter, salt, hash] = stored.split("$");
  if (kind !== "pbkdf2" || !iter || !salt || !hash) return false;
  const got = await pbkdf2(
    password,
    Uint8Array.from((salt.match(/../g) ?? []).map((h) => parseInt(h, 16))),
    Number(iter),
  );
  let diff = got.length ^ hash.length;
  for (let i = 0; i < Math.min(got.length, hash.length); i++) diff |= got.charCodeAt(i) ^ hash.charCodeAt(i);
  return diff === 0;
}

async function sitesPasswordSet(ctx: Ctx, input: unknown): Promise<{ ok: boolean }> {
  const o = rec(ctx, input);
  const site = mustSite(ctx, reqStr(ctx, o, "siteId"));
  const password = reqStr(ctx, o, "password");
  if (password.length < 8 || password.length > 200)
    fail(ctx, "validation.bad_input", "A site password is 8 to 200 characters.", { field: "password" });
  ctx.db.run(
    "UPDATE sites_site SET password_hash = ?, updated_at = ? WHERE id = ?",
    await hashPassword(password),
    ctx.now(),
    site.id,
  );
  // whoever had the old password signs in again
  ctx.db.run("DELETE FROM sites_ticket WHERE site_id = ? AND principal = ?", site.id, "visitor:password");
  return { ok: true };
}

const hashHex = async (text: string): Promise<string> =>
  toHex(await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
const SIGNIN_MS = 2 * 60_000;
export const SESSION_MS = 24 * 60 * 60_000;

/** A ticket for one person and one site: in the sign-in link for two minutes, then traded at the site's address for a day-long cookie. */
export async function newTicket(db: Db, siteId: string, principal: string, ms: number, now: number): Promise<string> {
  const token = toHex(globalThis.crypto.getRandomValues(new Uint8Array(24)));
  db.run("DELETE FROM sites_ticket WHERE expires_at < ?", now);
  db.run(
    "INSERT INTO sites_ticket (token_hash, site_id, principal, expires_at) VALUES (?, ?, ?, ?)",
    await hashHex(token),
    siteId,
    principal,
    now + ms,
  );
  return token;
}

async function sitesSigninLink(ctx: Ctx, input: unknown): Promise<{ url: string; expiresAt: number }> {
  const o = rec(ctx, input);
  const site = mustSite(ctx, reqStr(ctx, o, "siteId"));
  if (ctx.principal.kind !== "person") fail(ctx, "permission.no_grant", "Only a person signs in to a site.");
  const host = siteHostOf(site);
  if (!host) fail(ctx, "validation.precondition_failed", "This site has no address of its own yet.");
  const access = str(site.access);
  if (
    access === "private" &&
    site.owner !== ctx.principal.id &&
    ctx.authorize({ perm: null, level: "view" }, { type: "site", id: str(site.id) }).effect !== "allow"
  )
    fail(ctx, "permission.no_grant", "This site is not shared with you.");
  const nextRaw = optStr(ctx, o, "next") ?? "/";
  const next = nextRaw.startsWith("/") && !nextRaw.startsWith("//") ? nextRaw.slice(0, 2000) : "/";
  const token = await newTicket(ctx.db, str(site.id), ctx.principal.id, SIGNIN_MS, ctx.now());
  return {
    url: `https://${host}/__vyre/signin?t=${token}&next=${encodeURIComponent(next)}`,
    expiresAt: ctx.now() + SIGNIN_MS,
  };
}

/** The address a site has of its own: a custom domain with its certificate, else <slug>.<sites domain>. */
export function siteHostOf(site: Row): string | null {
  const domain = routesHost()?.domainOf?.(str(site.id)) ?? null;
  if (domain) return domain;
  const base = routesHost()?.sitesDomain?.() ?? null;
  return base && !isNull(site.slug) ? `${str(site.slug)}.${base}` : null;
}

/** For the host's push check: sites that deploy on a push, with whom to run the deploy as. */
export function autoDeploySites(ctx: Pick<Ctx, "db">): { siteId: string; as: string; branch: string }[] {
  return (
    ctx.db.all("SELECT * FROM sites_site WHERE auto_deploy = 1 AND deleted_at IS NULL AND source IS NOT NULL") as Row[]
  )
    .filter((r) => sourceOf(r)?.repo)
    .map((r) => ({
      siteId: str(r.id),
      as: isNull(r.deployed_by) ? str(r.owner) : str(r.deployed_by),
      branch: sourceOf(r)?.branch ?? "",
    }));
}

/**
 * The deploys a tick should ask for: a site that deploys on push, and only when its branch has a commit that was not deployed (the same check onlyIfChanged makes in the handler, made here, before the Gate, so a commit that was already
 * handled never reaches it). A commit that already waits for a person is not asked for again: one card and one row per site and commit. When the head cannot be read the commit is unknown: the site is asked for once and then waits.
 */
export async function autoDeployTargets(
  ctx: Pick<Ctx, "db">,
  headOf: (repo: string, branch: string | undefined) => Promise<string | null> = (repo, branch) =>
    remoteHead(repo, branch, null).catch(() => null),
): Promise<{ siteId: string; as: string; branch: string; head: string | null }[]> {
  const out: { siteId: string; as: string; branch: string; head: string | null }[] = [];
  for (const a of autoDeploySites(ctx)) {
    const site = (ctx.db.all("SELECT * FROM sites_site WHERE id = ?", a.siteId) as Row[])[0];
    const source = site ? sourceOf(site) : null;
    if (!source?.repo) continue;
    const head = await headOf(source.repo, source.branch).catch(() => null);
    const last = (
      ctx.db.all(
        "SELECT commit_sha FROM sites_deployment WHERE site_id = ? AND env = 'production' ORDER BY at DESC",
        a.siteId,
      ) as Row[]
    )[0];
    if (head && last && str(last.commit_sha) === head) continue;
    const waiting = ctx.db.all(
      "SELECT sha FROM sites_push WHERE site_id = ? AND action = 'deploy' AND error LIKE 'Waiting for a person%' AND failed_at > ?",
      a.siteId,
      Date.now() - 24 * 60 * 60 * 1000,
    ) as Row[];
    if (waiting.length > 0 && (head === null || waiting.some((w) => str(w.sha) === head))) continue;
    out.push({ ...a, head });
  }
  return out;
}

/** Containers that should be serving, for the host to start again after a server restart (Docker restarts them itself; this catches one that was removed). */
export function servingContainers(ctx: Pick<Ctx, "db">): { siteId: string; containerId: string }[] {
  const sites = (
    ctx.db.all("SELECT id, container_id FROM sites_site WHERE container_id IS NOT NULL AND deleted_at IS NULL") as Row[]
  ).map((r) => ({ siteId: str(r.id), containerId: str(r.container_id) }));
  // a preview that is up serves too
  const previews = (
    ctx.db.all(
      "SELECT d.site_id AS id, d.container_id AS container_id FROM sites_deployment d JOIN sites_site s ON s.id = d.site_id WHERE d.env = 'preview' AND d.state = 'ready' AND d.removed_at IS NULL AND d.container_id IS NOT NULL AND s.deleted_at IS NULL",
    ) as Row[]
  ).map((r) => ({ siteId: str(r.id), containerId: str(r.container_id) }));
  return [...sites, ...previews];
}

/** When a deployed site is stopped or deleted, its container goes; the images stay until the site is deleted. */
export async function stopDeployed(ctx: Ctx, site: Row, removeAll: boolean): Promise<void> {
  const r = runner();
  if (!r) return;
  if (!isNull(site.container_id) && removeAll) await r.remove(str(site.container_id)).catch(() => undefined);
  if (removeAll) {
    for (const d of many(ctx, "SELECT * FROM sites_deployment WHERE site_id = ? AND container_id IS NOT NULL", site.id))
      await r.remove(str(d.container_id)).catch(() => undefined);
    for (const d of many(ctx, "SELECT * FROM sites_deployment WHERE site_id = ? AND image IS NOT NULL", site.id))
      await r.removeImage(str(d.image)).catch(() => undefined);
    for (const a of many(ctx, "SELECT * FROM sites_addon WHERE site_id = ?", site.id))
      await r.removeAddon(str(site.id), str(a.kind) as AddonKind).catch(() => undefined);
    await r.removeNetwork(str(site.id)).catch(() => undefined);
    ctx.db.run("DELETE FROM sites_addon WHERE site_id = ?", site.id);
    ctx.db.run("UPDATE sites_site SET container_id = NULL WHERE id = ?", site.id);
  }
}

/** The build log of a deployment, or the running app's own log. */
export async function deployedLogs(
  ctx: Ctx,
  site: Row,
  o: Record<string, unknown>,
  tail: number,
): Promise<{ lines: string[]; state?: string; steps?: Record<string, unknown>[] }> {
  const build = o.build === true;
  const wanted = typeof o.deploymentId === "string" ? o.deploymentId : undefined;
  if (build || wanted) {
    const d = wanted
      ? one(ctx, "SELECT * FROM sites_deployment WHERE id = ? AND site_id = ?", wanted, site.id)
      : one(
          ctx,
          "SELECT * FROM sites_deployment WHERE site_id = ? AND env = ? ORDER BY at DESC",
          site.id,
          "production",
        );
    if (!d) return { lines: [] };
    const all = parseJson<string[]>(d.log, []);
    const lines = all.slice(-tail);
    const orphan = (d.state === "queued" || d.state === "building") && !done.has(str(d.id));
    const meta = parseJson<StepMeta | null>(d.steps, null);
    const steps = stepsIn(orphan ? closedMeta(meta) : meta, all.length, lines.length);
    return { lines, state: orphan ? "failed" : str(d.state), ...(steps ? { steps } : {}) };
  }
  const r = runner();
  if (!r || isNull(site.container_id)) return { lines: [] };
  try {
    return { lines: await r.logs(str(site.container_id), tail) };
  } catch {
    return { lines: [] };
  }
}

export const releaseHandlers = {
  "sites.deploy": (ctx: Ctx, input: unknown) => sitesDeploy(ctx, input),
  "sites.deploy_cancel": (ctx: Ctx, input: unknown) => sitesDeployCancel(ctx, input),
  "sites.ship": (ctx: Ctx, input: unknown) => sitesShip(ctx, input),
  "sites.previews": (ctx: Ctx, input: unknown) => sitesPreviews(ctx, input),
  "sites.preview_rebuild": (ctx: Ctx, input: unknown) => sitesPreviewRebuild(ctx, input),
  "sites.preview_remove": (ctx: Ctx, input: unknown) => sitesPreviewRemove(ctx, input),
  "sites.preview_promote": (ctx: Ctx, input: unknown) => sitesPreviewPromote(ctx, input),
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

export const _test = {
  diagnose,
  enqueue,
  hexOf,
  DeployLog,
  stepsIn,
  closedMeta,
  envOf,
  previewLabel,
  cancels,
  switching,
  cancelWait: (ms: number | null): void => {
    CANCEL_WAIT_MS = ms ?? 20_000;
  },
  githubRepo,
  useFetcher: (f: typeof fetchSource | null): void => {
    fetcher = f ?? fetchSource;
  },
};
