// Docker build driver for sites (spec 2.20; ARCH 7.6): picks how a repo is built, builds the image, starts and stops containers.
// Detection order: the repo's own Dockerfile, then node (package.json), python (requirements or pyproject), then static files.
// The standard Dockerfiles live in images/site-builders (buildpacks-lite). The layer cache is keyed by the lockfile hash:
// the hash is a build arg in the install layer and the image is tagged vyre-site-cache/<site>:<hash> for --cache-from.
// Docker runs through an injected Exec (argv, no shell), so tests drive a fake and the host passes dockerExec().
// Environment values never appear in argv or logs: `-e NAME` takes the value from the child process environment, and the value comes from EnvValue(ref).
// Containers run with every capability dropped, no new privileges, a memory and process cap, on the Space-private vyre-sites network.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { BuildRequest, BuildResult, SiteRuntime, StartRequest, StartResult } from "./deploy.ts";

export type BuilderKind = "dockerfile" | "node" | "python" | "static" | "static-build";

export interface BuildPlan {
  kind: BuilderKind;
  /** absolute path of the Dockerfile to build with: the repo's own, or a standard one from images/site-builders */
  dockerfile: string;
  /** build args (never secrets) */
  args: Record<string, string>;
  /** first 16 hex characters of the hash over the lockfiles; the layer cache key */
  lockHash: string;
  /** the lockfiles the hash covers, relative to the source */
  lockFiles: string[];
  /** one line saying what was detected, shown at the top of the build log */
  note: string;
}

export class BuildPlanError extends Error {}

export const BUILDERS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "images", "site-builders");
export const DEFAULT_PORT = 3000;
export const BUILD_TIMEOUT_MS = 10 * 60 * 1000;
export const CACHE_REPO = "vyre-site-cache";
export const IMAGE_REPO = "vyre-site";
const LOG_KEEP = 200;
const SOURCE_TIMEOUT_MS = 2 * 60 * 1000;
const LOCK_CANDIDATES = ["package-lock.json", "yarn.lock", "pnpm-lock.yaml", "npm-shrinkwrap.json", "requirements.txt", "poetry.lock", "uv.lock", "pyproject.toml"];
const STATIC_DIRS = [".", "public", "dist", "build", "_site"];
const IGNORED = [".git", "node_modules", ".env", ".env.*", ".DS_Store"];

// ---- exec ---------------------------------------------------------------------------------------------------

export interface ExecOptions {
  cwd?: string;
  /** added to the child environment (values for `-e NAME`); never logged */
  env?: Record<string, string>;
  timeoutMs?: number;
}

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type Exec = (argv: string[], opts?: ExecOptions) => Promise<ExecResult>;

/** Runs a command without a shell. A timeout kills the process and returns code 124. */
export function processExec(): Exec {
  return (argv, opts = {}) =>
    new Promise<ExecResult>((resolve) => {
      const [cmd, ...rest] = argv;
      if (cmd === undefined) {
        resolve({ code: 127, stdout: "", stderr: "no command" });
        return;
      }
      const child = spawn(cmd, rest, { cwd: opts.cwd, env: { ...process.env, ...(opts.env ?? {}) }, stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      const timer = opts.timeoutMs === undefined ? null : setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, opts.timeoutMs);
      child.stdout.on("data", (d: Buffer) => { stdout += d.toString("utf8"); });
      child.stderr.on("data", (d: Buffer) => { stderr += d.toString("utf8"); });
      child.on("error", (e) => {
        if (timer) clearTimeout(timer);
        resolve({ code: 127, stdout, stderr: stderr + e.message });
      });
      child.on("close", (code) => {
        if (timer) clearTimeout(timer);
        resolve({ code: timedOut ? 124 : (code ?? 1), stdout, stderr: timedOut ? `${stderr}\ntimed out after ${opts.timeoutMs} ms` : stderr });
      });
    });
}

// ---- detection ----------------------------------------------------------------------------------------------

function readText(dir: string, name: string): string | null {
  try {
    return fs.readFileSync(path.join(dir, name), "utf8");
  } catch {
    return null;
  }
}

const exists = (dir: string, name: string): boolean => fs.existsSync(path.join(dir, name));

/** SHA-256 through Web Crypto (no node:crypto outside kernel and vault, B3); the first 16 hex characters are the cache key. */
async function lockHash(dir: string, extra: string[]): Promise<{ hash: string; files: string[] }> {
  const files = [...extra, ...LOCK_CANDIDATES.filter((f) => exists(dir, f))];
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  for (const f of files) parts.push(enc.encode(`${f}\0`), enc.encode(readText(dir, f) ?? ""), enc.encode("\0"));
  const all = new Uint8Array(parts.reduce((n, a) => n + a.length, 0));
  let at = 0;
  for (const a of parts) { all.set(a, at); at += a.length; }
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", all));
  return { hash: Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16), files };
}

/** The `web:` line of a Procfile, if there is one. */
export function procfileWeb(dir: string): string | null {
  const text = readText(dir, "Procfile");
  if (text === null) return null;
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^web:\s*(.+)$/);
    if (m && m[1] !== undefined && m[1].trim() !== "") return m[1].trim();
  }
  return null;
}

interface PackageJson {
  main?: unknown;
  scripts?: Record<string, unknown>;
  dependencies?: Record<string, unknown>;
  devDependencies?: Record<string, unknown>;
}

function readPackage(dir: string): PackageJson {
  const text = readText(dir, "package.json");
  if (text === null) return {};
  try {
    const v: unknown = JSON.parse(text);
    return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as PackageJson) : {};
  } catch {
    throw new BuildPlanError("package.json is not valid JSON.");
  }
}

function nodeInstall(dir: string): string {
  if (exists(dir, "pnpm-lock.yaml")) return "corepack enable && pnpm install --frozen-lockfile";
  if (exists(dir, "yarn.lock")) return "corepack enable && yarn install --frozen-lockfile";
  if (exists(dir, "package-lock.json") || exists(dir, "npm-shrinkwrap.json")) return "npm ci";
  return "npm install";
}

/** Where a static generator writes its files, from the dependency that names it. */
function staticOutput(pkg: PackageJson): string {
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  if ("react-scripts" in deps) return "build";
  if ("@11ty/eleventy" in deps) return "_site";
  if ("next" in deps) return "out";
  return "dist";
}

function staticRoot(dir: string): string | null {
  for (const d of STATIC_DIRS) if (exists(dir, path.join(d, "index.html"))) return d;
  return null;
}

function template(name: string): string {
  return path.join(BUILDERS_DIR, name);
}

/** Decides how to build the source in `dir`. Throws BuildPlanError with a sentence a person can act on. */
export async function detectPlan(dir: string): Promise<BuildPlan> {
  if (exists(dir, "Dockerfile")) {
    const { hash, files } = await lockHash(dir, ["Dockerfile"]);
    return { kind: "dockerfile", dockerfile: path.join(dir, "Dockerfile"), args: {}, lockHash: hash, lockFiles: files, note: "Detected Dockerfile: building the repo's own Dockerfile." };
  }
  const procfile = procfileWeb(dir);
  if (exists(dir, "package.json")) {
    const pkg = readPackage(dir);
    const scripts = pkg.scripts ?? {};
    const hasStart = typeof scripts.start === "string";
    const hasBuild = typeof scripts.build === "string";
    const main = typeof pkg.main === "string" && exists(dir, pkg.main) ? pkg.main : null;
    const { hash, files } = await lockHash(dir, ["package.json"]);
    const install = nodeInstall(dir);
    if (!hasStart && procfile === null && main === null && hasBuild) {
      const out = staticOutput(pkg);
      return {
        kind: "static-build", dockerfile: template("Dockerfile.static-build"), lockHash: hash, lockFiles: files,
        args: { INSTALL_CMD: install, BUILD_CMD: "npm run build", STATIC_DIR: out },
        note: `Detected static site with a build step: npm run build, serving ${out}/.`,
      };
    }
    if (!hasStart && procfile === null && main === null) {
      throw new BuildPlanError("package.json has no start script, no main file and no build script. Add a start script (for example \"start\": \"node server.js\") or a Procfile with a web line.");
    }
    const start = procfile ?? (hasStart ? "npm start" : `node ${main}`);
    return {
      kind: "node", dockerfile: template("Dockerfile.node"), lockHash: hash, lockFiles: files,
      args: { INSTALL_CMD: install, BUILD_CMD: hasBuild ? "npm run build" : "", START_CMD: start },
      note: `Detected node: ${install}${hasBuild ? ", npm run build" : ""}, start with ${start}.`,
    };
  }
  if (exists(dir, "requirements.txt") || exists(dir, "pyproject.toml")) {
    const fromRequirements = exists(dir, "requirements.txt");
    const entry = ["app.py", "main.py", "server.py"].find((f) => exists(dir, f));
    const start = procfile ?? (exists(dir, "manage.py") ? "python manage.py runserver 0.0.0.0:$PORT" : entry !== undefined ? `python ${entry}` : null);
    if (start === null) {
      throw new BuildPlanError("No way to start this Python project. Add app.py or main.py, or a Procfile with a web line.");
    }
    const { hash, files } = await lockHash(dir, []);
    return {
      kind: "python", dockerfile: template("Dockerfile.python"), lockHash: hash, lockFiles: files,
      args: fromRequirements
        ? { INSTALL_CMD: "pip install --no-cache-dir -r requirements.txt", BUILD_CMD: "", START_CMD: start }
        : { INSTALL_CMD: "true", BUILD_CMD: "pip install --no-cache-dir .", START_CMD: start },
      note: `Detected python (${fromRequirements ? "requirements.txt" : "pyproject.toml"}): start with ${start}.`,
    };
  }
  const root = staticRoot(dir);
  if (root !== null) {
    const { hash, files } = await lockHash(dir, []);
    return { kind: "static", dockerfile: template("Dockerfile.static"), lockHash: hash, lockFiles: files, args: { STATIC_DIR: root }, note: `Detected static files in ${root === "." ? "the repo root" : `${root}/`}.` };
  }
  throw new BuildPlanError("Could not tell how to build this repo. Add a Dockerfile, a package.json with a start script, requirements.txt, or an index.html.");
}

/** .dockerignore: keeps .git, node_modules and env files out of the image whatever the repo says. */
export function ensureDockerignore(dir: string): void {
  const file = path.join(dir, ".dockerignore");
  const have = readText(dir, ".dockerignore") ?? "";
  const lines = new Set(have.split(/\r?\n/).map((l) => l.trim()));
  const add = IGNORED.filter((l) => !lines.has(l));
  if (add.length === 0) return;
  fs.writeFileSync(file, `${have}${have === "" || have.endsWith("\n") ? "" : "\n"}${add.join("\n")}\n`);
}

// ---- names --------------------------------------------------------------------------------------------------

const SAFE = /^[a-z0-9][a-z0-9_.-]{0,100}$/;

/** A docker name part: lowercase, only [a-z0-9_.-]. Throws on anything else, so an id can never become an option. */
export function safeName(part: string, what: string): string {
  const s = part.toLowerCase();
  if (!SAFE.test(s)) throw new BuildPlanError(`Unsafe ${what} for a container name.`);
  return s;
}

export const imageName = (siteId: string, deploymentId: string): string => `${IMAGE_REPO}/${safeName(siteId, "site id")}:${safeName(deploymentId, "deployment id")}`;
export const cacheName = (siteId: string, hash: string): string => `${CACHE_REPO}/${safeName(siteId, "site id")}:${safeName(hash, "cache key")}`;

// ---- source -------------------------------------------------------------------------------------------------

export interface Source {
  dir: string;
  commit: string;
  pullRequest?: number;
  /** removes the checkout */
  cleanup(): void;
}

export type FetchSource = (req: BuildRequest) => Promise<Source>;

const PR_BRANCH = /^(?:pull|pr)[/-](\d+)(?:\/head)?$/;

/** Parses a branch like `pr-12` or `pull/12/head` into a pull request number. */
export function pullRequestOf(branch: string): number | undefined {
  const m = branch.match(PR_BRANCH);
  return m && m[1] !== undefined ? Number(m[1]) : undefined;
}

function repoUrlOk(url: string): boolean {
  return !url.startsWith("-") && /^(https:\/\/|ssh:\/\/|git@[A-Za-z0-9.-]+:)/.test(url);
}

/** Clones the site's repo shallow. Pull request branches (`pr-12`) fetch refs/pull/12/head. */
export function gitSource(exec: Exec, root: string = os.tmpdir()): FetchSource {
  return async (req) => {
    if (req.repoUrl === null) throw new BuildPlanError("This site has no repository to build. Connect a repo first.");
    if (!repoUrlOk(req.repoUrl)) throw new BuildPlanError("The repository address must start with https:// or ssh://, or look like git@host:owner/repo.");
    if (req.branch.startsWith("-") || /[\s\0]/.test(req.branch)) throw new BuildPlanError("That branch name is not allowed.");
    const dir = fs.mkdtempSync(path.join(root, "vyre-site-src-"));
    const cleanup = () => fs.rmSync(dir, { recursive: true, force: true });
    const pr = pullRequestOf(req.branch);
    const run = async (argv: string[]): Promise<void> => {
      const r = await exec(argv, { cwd: dir, timeoutMs: SOURCE_TIMEOUT_MS });
      if (r.code !== 0) throw new BuildPlanError(`git failed: ${(r.stderr || r.stdout).trim().split("\n").slice(-3).join(" ")}`.slice(0, 400));
    };
    try {
      if (pr === undefined) {
        await run(["git", "clone", "--depth", "1", "--branch", req.branch, "--", req.repoUrl, "."]);
      } else {
        await run(["git", "init", "-q", "."]);
        await run(["git", "fetch", "--depth", "1", "--", req.repoUrl, `refs/pull/${pr}/head`]);
        await run(["git", "checkout", "-q", "FETCH_HEAD"]);
      }
      const head = await exec(["git", "rev-parse", "HEAD"], { cwd: dir, timeoutMs: 10_000 });
      const commit = head.stdout.trim().slice(0, 40);
      return pr === undefined ? { dir, commit, cleanup } : { dir, commit, pullRequest: pr, cleanup };
    } catch (e) {
      cleanup();
      throw e;
    }
  };
}

// ---- runtime ------------------------------------------------------------------------------------------------

export interface DockerRuntimeOptions {
  exec: Exec;
  fetchSource: FetchSource;
  /** the value for a container_env reference the Vault filled; used only to build the child environment */
  envValue: (ref: string) => Promise<string>;
  memory?: string;
  pids?: number;
}

function lines(text: string): string[] {
  return text.split(/\r?\n/).filter((l) => l !== "");
}

function tail(rows: string[], n: number = LOG_KEEP): string[] {
  return rows.length > n ? [`... ${rows.length - n} earlier lines left out`, ...rows.slice(-n)] : rows;
}

function envName(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name);
}

/** The lowest TCP port the image says it exposes, else 3000. */
export function exposedPort(json: string): number {
  try {
    const v: unknown = JSON.parse(json);
    if (typeof v !== "object" || v === null) return DEFAULT_PORT;
    const ports = Object.keys(v).map((k) => k.match(/^(\d+)\/tcp$/)).filter((m): m is RegExpMatchArray => m !== null).map((m) => Number(m[1])).sort((a, b) => a - b);
    return ports[0] ?? DEFAULT_PORT;
  } catch {
    return DEFAULT_PORT;
  }
}

/** The Docker driver behind SiteRuntime (configureSites passes it as `runtime`). */
export function dockerRuntime(o: DockerRuntimeOptions): SiteRuntime {
  const { exec } = o;
  const memory = o.memory ?? "512m";
  const pids = o.pids ?? 256;

  async function ensureNetwork(name: string): Promise<void> {
    const have = await exec(["docker", "network", "inspect", name], { timeoutMs: 15_000 });
    if (have.code === 0) return;
    const made = await exec(["docker", "network", "create", "--driver", "bridge", "--label", "vyre.sites=1", name], { timeoutMs: 30_000 });
    // a second caller can win the race to create it
    if (made.code !== 0 && !/already exists/i.test(made.stderr)) throw new Error(`Could not create the ${name} network: ${made.stderr.trim().slice(0, 200)}`);
  }

  async function pruneCache(siteId: string, keep: string): Promise<void> {
    const repo = `${CACHE_REPO}/${safeName(siteId, "site id")}`;
    const listed = await exec(["docker", "image", "ls", repo, "--format", "{{.Tag}}"], { timeoutMs: 15_000 });
    if (listed.code !== 0) return;
    for (const tag of lines(listed.stdout)) {
      if (tag !== keep && tag !== "<none>") await exec(["docker", "rmi", `${repo}:${tag}`], { timeoutMs: 30_000 });
    }
  }

  async function build(req: BuildRequest): Promise<BuildResult> {
    const log: string[] = [];
    let source: Source | null = null;
    try {
      const image = imageName(req.siteId, req.deploymentId);
      source = await o.fetchSource(req);
      const plan = await detectPlan(source.dir);
      log.push(plan.note, `Lockfiles: ${plan.lockFiles.join(", ") || "none"} (cache key ${plan.lockHash}).`);
      ensureDockerignore(source.dir);
      const cache = cacheName(req.siteId, plan.lockHash);
      const argv = [
        "docker", "build", "--file", plan.dockerfile, "--tag", image,
        "--label", `vyre.site=${req.siteId}`, "--label", `vyre.deployment=${req.deploymentId}`,
        "--build-arg", "BUILDKIT_INLINE_CACHE=1", "--build-arg", `LOCK_HASH=${plan.lockHash}`,
        "--cache-from", cache,
      ];
      for (const [k, v] of Object.entries(plan.args)) argv.push("--build-arg", `${k}=${v}`);
      argv.push(source.dir);
      const built = await exec(argv, { timeoutMs: BUILD_TIMEOUT_MS });
      log.push(...lines(built.stdout), ...lines(built.stderr));
      if (built.code !== 0) {
        log.push(built.code === 124 ? "The build ran out of time (10 minutes)." : "The build failed. The last lines above say why.");
        return { ok: false, log: tail(log) };
      }
      await exec(["docker", "tag", image, cache], { timeoutMs: 15_000 });
      await pruneCache(req.siteId, plan.lockHash);
      log.push(`Built ${image}.`);
      const out: BuildResult = { ok: true, image, commit: source.commit, log: tail(log) };
      if (source.pullRequest !== undefined) out.pullRequest = source.pullRequest;
      return out;
    } catch (e) {
      log.push(e instanceof Error ? e.message : String(e));
      return { ok: false, log: tail(log) };
    } finally {
      source?.cleanup();
    }
  }

  async function start(req: StartRequest): Promise<StartResult> {
    const name = safeName(req.name, "container name");
    const network = safeName(req.network, "network");
    const image = req.image;
    if (image.startsWith("-")) throw new Error("Unsafe image name.");
    await ensureNetwork(network);
    const inspected = await exec(["docker", "image", "inspect", "--format", "{{json .Config.ExposedPorts}}", image], { timeoutMs: 15_000 });
    if (inspected.code !== 0) throw new Error(`The image ${image} is not on this server. Build the site again.`);
    const port = exposedPort(inspected.stdout.trim());
    const childEnv: Record<string, string> = {};
    const argv = [
      "docker", "run", "--detach", "--name", name, "--network", network, "--restart", "unless-stopped",
      "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--memory", memory, "--pids-limit", String(pids),
      "--label", `vyre.site=${req.siteId}`, "--label", `vyre.deployment=${req.deploymentId}`, "--label", `vyre.env=${req.env}`,
      "--env", `PORT=${port}`, "--env", `VYRE_SITE_ID=${req.siteId}`, "--env", `VYRE_SERVICE_PRINCIPAL=${req.servicePrincipal}`,
    ];
    for (const e of req.envRefs) {
      if (!envName(e.name)) throw new Error(`"${e.name}" is not a valid environment variable name.`);
      childEnv[e.name] = await o.envValue(e.ref);
      argv.push("--env", e.name);
    }
    argv.push("--", image);
    // the name may be left over from a failed earlier start
    await exec(["docker", "rm", "--force", name], { timeoutMs: 30_000 });
    const ran = await exec(argv, { env: childEnv, timeoutMs: 60_000 });
    if (ran.code !== 0) throw new Error(`The container did not start: ${ran.stderr.trim().split("\n").slice(-2).join(" ").slice(0, 300)}`);
    const containerId = ran.stdout.trim().split("\n").pop()?.trim() ?? "";
    if (!/^[0-9a-f]{12,64}$/.test(containerId)) throw new Error("Docker did not return a container id.");
    return { containerId, upstream: `${name}:${port}` };
  }

  async function stop(containerId: string): Promise<void> {
    if (!/^[0-9a-f]{12,64}$/.test(containerId)) return;
    const r = await exec(["docker", "rm", "--force", containerId], { timeoutMs: 30_000 });
    if (r.code !== 0 && !/no such container/i.test(r.stderr)) throw new Error(`Could not stop the container: ${r.stderr.trim().slice(0, 200)}`);
  }

  async function logs(containerId: string, count: number): Promise<string[]> {
    if (!/^[0-9a-f]{12,64}$/.test(containerId)) return [];
    const n = Math.max(1, Math.min(Math.trunc(count), 1000));
    const r = await exec(["docker", "logs", "--tail", String(n), "--timestamps", containerId], { timeoutMs: 15_000 });
    // docker writes container stderr to our stderr; keep both, in arrival order is not recoverable, so stdout first
    return [...lines(r.stdout), ...lines(r.stderr)].slice(-n);
  }

  return { build, start, stop, logs };
}
