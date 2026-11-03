// How a deploy reads a project, with no Docker: Railway's own config first (railway.json, railway.toml, nixpacks.toml, a Procfile), then package.json, requirements.txt, a Dockerfile or plain
// files; what it needs (Postgres, Redis) from its env names and dependencies; and the source helpers (repo addresses, zips) and the plain words a failure ends in.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { test } from "node:test";
import { exampleEnv, needsOf, readToml, sitePlan } from "../handlers/plan.ts";
import { cleanBranch, repoUrl, unzip } from "../handlers/source.ts";
import { _test } from "../handlers/release.ts";
import { contextTar, frames } from "../handlers/runner.ts";

const FIX = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "..", "..", "fixtures", "sites");
function dir(files: Record<string, string>): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-plan-"));
  for (const [n, t] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(d, n)), { recursive: true }); fs.writeFileSync(path.join(d, n), t); }
  return d;
}
const pkg = (o: object): string => JSON.stringify(o);

test("railway.json: the build and start commands and the health path win over package.json", async () => {
  const p = await sitePlan(path.join(FIX, "railway"));
  assert.equal(p.kind, "node");
  assert.equal(p.args.BUILD_CMD, "npm run compile");
  assert.equal(p.args.START_CMD, "node dist/index.js");
  assert.equal(p.health, "/health");
  assert.equal(p.from[0], "railway.json");
});

test("railway.toml and nixpacks.toml are read too", async () => {
  const toml = await sitePlan(dir({ "package.json": pkg({ scripts: { start: "node a.js" } }), "railway.toml": "[build]\nbuildCommand = \"npm run x\"\n\n[deploy]\nstartCommand = \"node b.js\"\nhealthcheckPath = \"/up\"\n" }));
  assert.equal(toml.args.START_CMD, "node b.js");
  assert.equal(toml.args.BUILD_CMD, "npm run x");
  assert.equal(toml.health, "/up");
  const nix = await sitePlan(dir({ "package.json": pkg({ scripts: { build: "vite build" } }), "nixpacks.toml": "[phases.install]\ncmds = [\"npm ci --omit=optional\"]\n[phases.build]\ncmds = [\"npm run build\", \"npm run post\"]\n[start]\ncmd = \"node server.js\"\n" }));
  assert.equal(nix.kind, "node", "a start command makes a build-only project a server");
  assert.equal(nix.args.INSTALL_CMD, "npm ci --omit=optional");
  assert.equal(nix.args.BUILD_CMD, "npm run build && npm run post");
  assert.equal(nix.args.START_CMD, "node server.js");
  assert.deepEqual(readToml("a = [\n  \"x\",\n  'y'\n]\n[s]\nb = 3\nc = true # note\n"), { "": { a: ["x", "y"] }, s: { b: 3, c: true } });
});

test("a Railway dockerfilePath builds that file; the NIXPACKS builder ignores a Dockerfile as Railway does", async () => {
  const d = await sitePlan(dir({ "deploy/Web.Dockerfile": "FROM node:24-alpine\nEXPOSE 4000\n", "railway.json": JSON.stringify({ build: { dockerfilePath: "deploy/Web.Dockerfile" } }) }));
  assert.equal(d.kind, "dockerfile");
  assert.equal(d.port, 4000);
  const n = await sitePlan(dir({ Dockerfile: "FROM scratch\n", "package.json": pkg({ scripts: { start: "node a.js" } }), "railway.json": JSON.stringify({ build: { builder: "NIXPACKS" } }) }));
  assert.equal(n.kind, "node");
  await assert.rejects(sitePlan(dir({ "railway.json": JSON.stringify({ build: { dockerfilePath: "../x" } }) })), /not in the project/);
});

test("each fixture kind is read the way its test expects", async () => {
  const kinds: Record<string, string> = { static: "static", vite: "static-build", next: "node", express: "node", dockerfile: "dockerfile", fastapi: "python", "flask-procfile": "python" };
  for (const [f, k] of Object.entries(kinds)) assert.equal((await sitePlan(path.join(FIX, f))).kind, k, f);
  assert.equal((await sitePlan(path.join(FIX, "fastapi"))).args.START_CMD, "uvicorn main:app --host 0.0.0.0 --port $PORT");
  assert.equal((await sitePlan(path.join(FIX, "flask-procfile"))).args.START_CMD, "gunicorn app:app --bind 0.0.0.0:$PORT --workers 2");
  assert.equal((await sitePlan(path.join(FIX, "dockerfile"))).port, 8080);
  assert.equal((await sitePlan(dir({ "requirements.txt": "flask\n", "app.py": "app = Flask(__name__)\n" }))).args.START_CMD, "flask --app app:app run --host 0.0.0.0 --port $PORT");
});

test("needs: Postgres and Redis from env names and dependencies, not from a SQLite DATABASE_URL", () => {
  assert.deepEqual(needsOf(path.join(FIX, "express"), exampleEnv(path.join(FIX, "express"))), ["postgres"]);
  assert.deepEqual(needsOf(dir({ ".env.example": "DATABASE_URL=file:./dev.db\n" }), ["DATABASE_URL"]), []);
  assert.deepEqual(needsOf(dir({ "package.json": pkg({ dependencies: { ioredis: "5", "@prisma/client": "5" } }), "prisma/schema.prisma": "datasource db {\n provider = \"postgresql\"\n}" }), []), ["postgres", "redis"]);
  assert.deepEqual(needsOf(dir({ "package.json": pkg({ dependencies: { "@prisma/client": "5" } }), "prisma/schema.prisma": "provider = \"sqlite\"" }), []), []);
  assert.deepEqual(needsOf(dir({ "requirements.txt": "django\npsycopg2-binary==2.9\nredis\n" }), []), ["postgres", "redis"]);
  assert.deepEqual(exampleEnv(dir({ ".env.example": "# c\nexport A=1\nB = 2\n_C=\n" })), ["A", "B", "_C"]);
});

test("source: repo addresses, branches, and a zip read from its central directory", () => {
  assert.equal(repoUrl("acme/cx-dashboard"), "https://github.com/acme/cx-dashboard.git");
  assert.equal(repoUrl("https://github.com/acme/cx"), "https://github.com/acme/cx.git");
  assert.equal(repoUrl("https://gitlab.com/acme/cx.git"), "https://gitlab.com/acme/cx.git");
  assert.throws(() => repoUrl("https://tok@github.com/acme/cx"), /Leave the token out/);
  assert.throws(() => repoUrl("file:///etc"), /https address/);
  assert.throws(() => cleanBranch("--upload-pack=x"), /cannot be used/);
  assert.equal(cleanBranch(" main "), "main");
  // a two-entry zip: one stored, one deflated
  const entries = [{ name: "a/index.html", data: Buffer.from("<p>hi</p>"), method: 0 }, { name: "a/big.txt", data: Buffer.from("x".repeat(2000)), method: 8 }];
  const locals: Buffer[] = [], centrals: Buffer[] = [];
  let at = 0;
  for (const e of entries) {
    const body = e.method === 8 ? zlib.deflateRawSync(e.data) : e.data;
    const name = Buffer.from(e.name);
    const l = Buffer.alloc(30); l.writeUInt32LE(0x04034b50, 0); l.writeUInt16LE(e.method, 8); l.writeUInt32LE(body.length, 18); l.writeUInt32LE(e.data.length, 22); l.writeUInt16LE(name.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(e.method, 10); c.writeUInt32LE(body.length, 20); c.writeUInt32LE(e.data.length, 24); c.writeUInt16LE(name.length, 28); c.writeUInt32LE(at, 42);
    locals.push(l, name, body); centrals.push(c, name); at += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(at, 16);
  const out = unzip(Buffer.concat([...locals, cd, end]));
  assert.deepEqual(out.map((e) => [e.name, e.data.toString().slice(0, 9)]), [["a/index.html", "<p>hi</p>"], ["a/big.txt", "xxxxxxxxx"]]);
  assert.throws(() => unzip(Buffer.from("not a zip at all, not even close to one")), /not a zip/);
});

test("failures end in plain words and one fix", () => {
  const d = _test.diagnose;
  assert.deepEqual(d(["Error: connect ECONNREFUSED 127.0.0.1:5432"], { stage: "start", port: 3000 }), { problem: "It needs a Postgres database and has none. Add one: it gets DATABASE_URL.", fix: "add_postgres" });
  assert.equal(d(["Error: connect ECONNREFUSED 127.0.0.1:5432"], { stage: "start", port: 3000, hasPostgres: true }).fix, "open_logs");
  assert.equal(d(["Error: STRIPE_KEY is missing"], { stage: "start" }).fix, "set_env");
  assert.match(d(["Error: STRIPE_KEY is missing"], { stage: "start" }).problem, /STRIPE_KEY is not set/);
  assert.equal(d(["listening"], { stage: "start", oom: true, memoryMb: 512 }).fix, "more_memory");
  assert.equal(d(["server started"], { stage: "start", port: 8080 }).fix, "set_port");
  assert.equal(d(["npm ERR! code ERESOLVE"], { stage: "build" }).fix, "open_logs");
  assert.equal(d(["write /x: no space left on device"], { stage: "build" }).fix, "free_space");
  assert.equal(d(["redis ECONNREFUSED 10.0.0.2:6379"], { stage: "start" }).fix, "add_redis");
});

test("the build context leaves out .git, node_modules and env files, keeps .env.example, and the log frames read in order", () => {
  const d = dir({ "index.html": "x", ".env": "SECRET=1", ".env.local": "S=2", ".env.example": "A=", "node_modules/m/i.js": "x", ".git/HEAD": "x", "src/a.js": "y" });
  const tar = Buffer.from(contextTar(d, [{ name: ".vyre.Dockerfile", text: "FROM x" }]));
  const names: string[] = [];
  for (let at = 0; at + 512 <= tar.length; at += 512) { const n = tar.subarray(at, at + 100).toString("utf8").replace(/\0.*$/s, ""); const size = parseInt(tar.subarray(at + 124, at + 136).toString("utf8").replace(/\0.*$/s, "").trim() || "0", 8); if (n && !n.endsWith("/")) names.push(n); at += Math.ceil(size / 512) * 512; }
  assert.deepEqual(names.sort(), [".env.example", ".vyre.Dockerfile", "index.html", "src/a.js"]);
  const frame = (k: number, s: string): Buffer => { const b = Buffer.from(s); const h = Buffer.alloc(8); h[0] = k; h.writeUInt32BE(b.length, 4); return Buffer.concat([h, b]); };
  assert.deepEqual(frames(new Uint8Array(Buffer.concat([frame(1, "one\ntw"), frame(2, "o\nthree\n")]))), ["one", "two", "three"]);
});
