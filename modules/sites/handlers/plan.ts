// How a deployed site is built and started, read from the project the way Railway reads it: railway.json or railway.toml first, then nixpacks.toml, a Procfile, package.json
// scripts, requirements.txt or pyproject.toml, a Dockerfile, or plain files. builders.ts detectPlan picks the builder; this file applies what the project says on top of it and works out
// what the app needs that a server can give it (Postgres, Redis) from its env names, its dependencies and its Railway config. Pure reads of a folder: no Docker, no network.
import fs from "node:fs";
import path from "node:path";
import { BUILDERS_DIR, BuildPlanError, detectPlan } from "./builders.ts";
import type { BuildPlan } from "./builders.ts";

export interface SitePlan extends BuildPlan {
  /** the command that builds the app, if any, as a person would type it */
  build?: string;
  /** the command that starts the app */
  start?: string;
  /** the port the app listens on (it is also given as PORT) */
  port: number;
  /** a path that answers 200 once the app is up; "/" when the project names none */
  health: string;
  needs: ("postgres" | "redis")[];
  /** env names the app reads that are not given by Vyre (from .env.example and the Railway config) */
  env: string[];
  /** which files decided it, for the log and the sheet */
  from: string[];
}

const read = (dir: string, name: string): string | null => { try { return fs.readFileSync(path.join(dir, name), "utf8"); } catch { return null; } };
const has = (dir: string, name: string): boolean => fs.existsSync(path.join(dir, name));

/** A small TOML reader for the keys deploy configs use: [section] and [a.b] headers, key = "string" | 'string' | number | bool | ["a", "b"]. Anything else is skipped. */
export function readToml(text: string): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = { "": {} };
  let section = "";
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = (lines[i] ?? "").replace(/\s+#.*$/, "").trim();
    if (line === "" || line.startsWith("#")) continue;
    const head = /^\[\[?\s*([A-Za-z0-9_.-]+)\s*\]\]?$/.exec(line);
    if (head) { section = head[1] as string; out[section] ??= {}; continue; }
    const kv = /^([A-Za-z0-9_.-]+|"[^"]+")\s*=\s*(.+)$/.exec(line);
    if (!kv) continue;
    const key = (kv[1] as string).replace(/^"|"$/g, "");
    let raw = (kv[2] as string).trim();
    // an array may run over several lines
    if (raw.startsWith("[") && !raw.endsWith("]")) { while (i + 1 < lines.length && !raw.endsWith("]")) raw += ` ${(lines[++i] ?? "").replace(/\s+#.*$/, "").trim()}`; }
    (out[section] ??= {})[key] = tomlValue(raw);
  }
  return out;
}

function tomlValue(raw: string): unknown {
  if (/^".*"$/.test(raw)) return raw.slice(1, -1).replace(/\\"/g, "\"").replace(/\\\\/g, "\\");
  if (/^'.*'$/.test(raw)) return raw.slice(1, -1);
  if (raw === "true" || raw === "false") return raw === "true";
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  if (raw.startsWith("[") && raw.endsWith("]")) {
    const items: unknown[] = [];
    for (const m of raw.slice(1, -1).matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'|(-?\d+(?:\.\d+)?)/g)) items.push(m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : Number(m[3]));
    return items;
  }
  return undefined;
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined);
const cmds = (v: unknown): string | undefined => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "").join(" && ") || undefined : str(v));

/** What a Railway config says: railway.json (or railway.toml) build and deploy keys. */
export function railwayConfig(dir: string): { build?: string; start?: string; dockerfile?: string; health?: string; builder?: string; file?: string } {
  const json = read(dir, "railway.json");
  if (json !== null) {
    let v: { build?: Record<string, unknown>; deploy?: Record<string, unknown> };
    try { v = JSON.parse(json) as typeof v; } catch { throw new BuildPlanError("railway.json is not valid JSON."); }
    return clean({ build: str(v.build?.["buildCommand"]), start: str(v.deploy?.["startCommand"]), dockerfile: str(v.build?.["dockerfilePath"]), health: str(v.deploy?.["healthcheckPath"]), builder: str(v.build?.["builder"]), file: "railway.json" });
  }
  const toml = read(dir, "railway.toml");
  if (toml !== null) {
    const t = readToml(toml);
    return clean({ build: str(t["build"]?.["buildCommand"]), start: str(t["deploy"]?.["startCommand"]), dockerfile: str(t["build"]?.["dockerfilePath"]), health: str(t["deploy"]?.["healthcheckPath"]), builder: str(t["build"]?.["builder"]), file: "railway.toml" });
  }
  return {};
}

/** What nixpacks.toml says: the install and build phases and the start command. */
export function nixpacksConfig(dir: string): { install?: string; build?: string; start?: string } {
  const text = read(dir, "nixpacks.toml");
  if (text === null) return {};
  const t = readToml(text);
  return clean({ install: cmds(t["phases.install"]?.["cmds"]), build: cmds(t["phases.build"]?.["cmds"]), start: str(t["start"]?.["cmd"]) });
}

function clean<T extends Record<string, unknown>>(o: T): T {
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
  return o;
}

/** Env names an example file lists (.env.example, .env.sample, .env.template), without values. */
export function exampleEnv(dir: string): string[] {
  const names = new Set<string>();
  for (const f of [".env.example", ".env.sample", ".env.template", ".env.dist", "example.env"]) {
    const text = read(dir, f);
    if (text === null) continue;
    for (const line of text.split(/\r?\n/)) {
      const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
      if (m) names.add(m[1] as string);
    }
  }
  return [...names];
}

const PG_DEPS = ["pg", "postgres", "@prisma/client", "prisma", "drizzle-orm", "knex", "sequelize", "typeorm", "@neondatabase/serverless", "pg-promise", "slonik", "kysely"];
const PG_PY = ["psycopg", "psycopg2", "psycopg2-binary", "asyncpg", "sqlalchemy", "django", "sqlmodel", "databases"];
const REDIS_DEPS = ["redis", "ioredis", "bullmq", "bull", "@upstash/redis", "connect-redis"];
const REDIS_PY = ["redis", "rq", "celery", "aioredis"];

/** Postgres and Redis an app needs: an env name that says so, or a dependency that only talks to one. DATABASE_URL with a SQLite or MySQL scheme in the example does not count. */
export function needsOf(dir: string, env: readonly string[]): ("postgres" | "redis")[] {
  const out = new Set<"postgres" | "redis">();
  const example = [".env.example", ".env.sample", ".env.template"].map((f) => read(dir, f) ?? "").join("\n");
  const dbUrl = /^\s*DATABASE_URL\s*=\s*["']?([a-z0-9+]+):/im.exec(example)?.[1];
  if (env.some((n) => /^(DATABASE_URL|POSTGRES_URL|PG(HOST|DATABASE|URL)|DATABASE_PRIVATE_URL)$/.test(n)) && (dbUrl === undefined || /^postgres/.test(dbUrl))) out.add("postgres");
  if (env.some((n) => /^(REDIS_URL|REDIS_PRIVATE_URL|REDISHOST|KV_URL)$/.test(n))) out.add("redis");
  const pkgText = read(dir, "package.json");
  if (pkgText !== null) {
    try {
      const pkg = JSON.parse(pkgText) as { dependencies?: Record<string, unknown>; devDependencies?: Record<string, unknown> };
      const deps = Object.keys({ ...(pkg.dependencies ?? {}) });
      if (deps.some((d) => PG_DEPS.includes(d))) {
        // prisma says which database in its schema
        const schema = read(dir, "prisma/schema.prisma");
        if (schema === null || /provider\s*=\s*"postgres(ql)?"/.test(schema)) out.add("postgres");
      }
      if (deps.some((d) => REDIS_DEPS.includes(d))) out.add("redis");
    } catch { /* detectPlan says it is not valid JSON */ }
  }
  const reqs = `${read(dir, "requirements.txt") ?? ""}\n${read(dir, "pyproject.toml") ?? ""}`.toLowerCase();
  const pyNames = new Set(reqs.split(/[\s"',[\]=<>~!;]+/).map((w) => w.replace(/\[.*$/, "")).filter(Boolean));
  if (PG_PY.some((d) => pyNames.has(d)) && (pyNames.has("psycopg") || pyNames.has("psycopg2") || pyNames.has("psycopg2-binary") || pyNames.has("asyncpg"))) out.add("postgres");
  if (REDIS_PY.some((d) => pyNames.has(d))) out.add("redis");
  return [...out].sort();
}

/** The Python start command when the project names none: an ASGI app under uvicorn, a Flask app on the given port, else the entry file. */
function pythonStart(dir: string, current: string | undefined): string | undefined {
  const reqs = `${read(dir, "requirements.txt") ?? ""}\n${read(dir, "pyproject.toml") ?? ""}`.toLowerCase();
  const entry = ["main.py", "app.py", "server.py"].find((f) => has(dir, f));
  if (!entry) return current;
  const mod = entry.replace(/\.py$/, "");
  const src = read(dir, entry) ?? "";
  const appVar = /^(\w+)\s*=\s*(FastAPI|Starlette|Flask|Quart)\s*\(/m.exec(src)?.[1] ?? "app";
  if (/fastapi|starlette/.test(reqs) || /FastAPI\(|Starlette\(/.test(src)) {
    if (/uvicorn/.test(reqs)) return `uvicorn ${mod}:${appVar} --host 0.0.0.0 --port $PORT`;
    if (/hypercorn/.test(reqs)) return `hypercorn ${mod}:${appVar} --bind 0.0.0.0:$PORT`;
  }
  if (/flask/.test(reqs) || /Flask\(/.test(src)) {
    if (/gunicorn/.test(reqs)) return `gunicorn ${mod}:${appVar} --bind 0.0.0.0:$PORT`;
    return `flask --app ${mod}:${appVar} run --host 0.0.0.0 --port $PORT`;
  }
  return current;
}

/** The port a Dockerfile says (EXPOSE in the last stage), else 3000. */
function dockerfilePortOf(file: string): number | null {
  const text = (() => { try { return fs.readFileSync(file, "utf8"); } catch { return ""; } })();
  const stages = text.split(/^\s*FROM\s/im);
  const last = stages.length > 1 ? (stages[stages.length - 1] ?? "") : text;
  for (const line of last.split(/\r?\n/)) {
    const m = /^\s*EXPOSE\s+(\d{1,5})/i.exec(line);
    if (m && Number(m[1]) >= 1 && Number(m[1]) <= 65535) return Number(m[1]);
  }
  return null;
}

const NEXT_STANDALONE = /output\s*:\s*["']standalone["']/;

/** The whole plan for a source folder. Throws BuildPlanError with a sentence a person can act on. */
export async function sitePlan(dir: string): Promise<SitePlan> {
  const rw = railwayConfig(dir);
  const nix = nixpacksConfig(dir);
  const from: string[] = [];
  if (rw.file) from.push(rw.file);
  if (Object.keys(nix).length) from.push("nixpacks.toml");
  let base: BuildPlan;
  if (rw.dockerfile && rw.builder !== "NIXPACKS" && rw.builder !== "RAILPACK") {
    const file = path.resolve(dir, rw.dockerfile);
    if (!file.startsWith(path.resolve(dir) + path.sep) || !fs.existsSync(file)) throw new BuildPlanError(`${rw.file} names ${rw.dockerfile}, which is not in the project.`);
    base = { kind: "dockerfile", dockerfile: file, args: {}, lockHash: "railway", lockFiles: [rw.dockerfile], note: `Detected ${rw.dockerfile} from ${rw.file}: building it as is.` };
  } else if ((rw.builder === "NIXPACKS" || rw.builder === "RAILPACK") && has(dir, "Dockerfile")) {
    // Railway was told to ignore the Dockerfile: so is this
    const moved = path.join(dir, "Dockerfile");
    fs.renameSync(moved, path.join(dir, "Dockerfile.ignored-by-railway"));
    try { base = await detectPlan(dir); } finally { fs.renameSync(path.join(dir, "Dockerfile.ignored-by-railway"), moved); }
  } else {
    try { base = await detectPlan(dir); } catch (e) {
      // a start command from the config is enough for a node or python project
      if (e instanceof BuildPlanError && (rw.start || nix.start || null) !== null && (has(dir, "package.json") || has(dir, "requirements.txt") || has(dir, "pyproject.toml"))) {
        base = has(dir, "package.json")
          ? { kind: "node", dockerfile: path.join(BUILDERS_DIR, "Dockerfile.node"), args: { INSTALL_CMD: "npm install", BUILD_CMD: "", START_CMD: "" }, lockHash: "none", lockFiles: [], note: "" }
          : { kind: "python", dockerfile: path.join(BUILDERS_DIR, "Dockerfile.python"), args: { INSTALL_CMD: has(dir, "requirements.txt") ? "pip install --no-cache-dir -r requirements.txt" : "true", BUILD_CMD: has(dir, "requirements.txt") ? "" : "pip install --no-cache-dir .", START_CMD: "" }, lockHash: "none", lockFiles: [], note: "" };
      } else throw e;
    }
  }
  const args = { ...base.args };
  if (base.kind === "dockerfile") {
    from.push(path.relative(dir, base.dockerfile) || "Dockerfile");
    const port = dockerfilePortOf(base.dockerfile) ?? 3000;
    return { ...base, args, port, health: rw.health ?? "/", needs: needsOf(dir, [...exampleEnv(dir)]), env: exampleEnv(dir), from, ...(rw.start ? { start: rw.start } : {}) };
  }
  if (has(dir, "Procfile")) from.push("Procfile");
  if (base.kind === "node" || base.kind === "static-build") from.push("package.json");
  if (base.kind === "python") from.push(has(dir, "requirements.txt") ? "requirements.txt" : "pyproject.toml");
  if (base.kind === "static") from.push("index.html");
  // what the config says beats what was guessed
  if (nix.install && "INSTALL_CMD" in args) args.INSTALL_CMD = nix.install;
  const buildCmd = rw.build ?? nix.build;
  const startCmd = rw.start ?? nix.start;
  if (buildCmd && (base.kind === "node" || base.kind === "python" || base.kind === "static-build")) args.BUILD_CMD = buildCmd;
  let kind = base.kind;
  let dockerfile = base.dockerfile;
  if (startCmd && base.kind === "static-build") {
    // a build script and a start command in the config: a node server after all
    kind = "node"; dockerfile = path.join(BUILDERS_DIR, "Dockerfile.node");
    args.START_CMD = startCmd;
    delete args.STATIC_DIR;
  } else if (startCmd && (base.kind === "node" || base.kind === "python")) args.START_CMD = startCmd;
  if (kind === "python" && !startCmd && !has(dir, "Procfile")) {
    const s = pythonStart(dir, args.START_CMD);
    if (s) args.START_CMD = s;
  }
  // Next.js serves on PORT with next start; a standalone build starts its own server
  const pkgText = read(dir, "package.json") ?? "";
  if (kind === "node" && /"next"\s*:/.test(pkgText) && !startCmd) {
    const conf = ["next.config.js", "next.config.mjs", "next.config.ts", "next.config.cjs"].map((f) => read(dir, f) ?? "").join("\n");
    if (NEXT_STANDALONE.test(conf) && !/"start"\s*:/.test(pkgText)) args.START_CMD = "node .next/standalone/server.js";
  }
  const env = [...new Set([...exampleEnv(dir)])];
  const needs = needsOf(dir, env);
  const pretty = (s: string | undefined): string | undefined => (s && s !== "true" && s.trim() !== "" ? s : undefined);
  const build = kind === "static" ? undefined : [pretty(args.INSTALL_CMD), pretty(args.BUILD_CMD)].filter(Boolean).join(", ") || undefined;
  const start = kind === "static" || kind === "static-build" ? `serve ${args.STATIC_DIR ?? "."}/` : pretty(args.START_CMD);
  const note = kind === "static" ? `Plain files from ${args.STATIC_DIR === "." ? "the project root" : `${args.STATIC_DIR}/`}, served as they are.`
    : kind === "static-build" ? `${base.note.replace(/^Detected /, "").replace(/\.$/, "")}${buildCmd ? ` (build from ${rw.file ?? "nixpacks.toml"})` : ""}.`
    : `${kind === "node" ? "Node" : "Python"}: ${build ? `${build}, then ` : ""}${start ?? "start"}${from.length > 1 ? ` (from ${from.join(", ")})` : ""}.`;
  return { ...base, kind, dockerfile, args, note: note.charAt(0).toUpperCase() + note.slice(1), port: 3000, health: rw.health ?? "/", needs, env, from: [...new Set(from)], ...(build ? { build } : {}), ...(start ? { start } : {}) };
}
