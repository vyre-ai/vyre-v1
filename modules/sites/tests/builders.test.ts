// Docker build driver for sites: detection, the lockfile cache key, build/start/stop/logs argv, and the driver inside the real sites handlers (spec 2.20; ARCH 7.6).
// Docker is a fake Exec that records argv, so this file runs everywhere. The real-Docker version of the same flows is builders.heavy.test.ts.
// @reads /images/site-builders/Dockerfile.node

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import { configureSites } from "../handlers/deploy.ts";
import type { BuildRequest } from "../handlers/deploy.ts";
import {
  BUILDERS_DIR, BuildPlanError, cacheName, detectPlan, dockerRuntime, ensureDockerignore, exposedPort, gitSource, imageName, procfileWeb, pullRequestOf, safeName,
} from "../handlers/builders.ts";
import type { Exec, ExecOptions, ExecResult, FetchSource } from "../handlers/builders.ts";
import { handlers } from "../impl.ts";
import { harness } from "../fixtures/world.ts";

function repo(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-builders-test-"));
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), text);
  }
  return dir;
}

const pkg = (o: Record<string, unknown>) => JSON.stringify({ name: "x", ...o });

async function plan(files: Record<string, string>) {
  const dir = repo(files);
  try {
    return await detectPlan(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function planError(files: Record<string, string>): Promise<string> {
  try {
    await plan(files);
  } catch (e) {
    if (e instanceof BuildPlanError) return e.message;
    throw e;
  }
  return "";
}

// ---- a fake docker ------------------------------------------------------------------------------------------

interface Call { argv: string[]; opts: ExecOptions }

class FakeDocker {
  calls: Call[] = [];
  networks = new Set<string>();
  cacheTags: string[] = [];
  exposed = '{"3000/tcp":{}}';
  buildCode = 0;
  runCode = 0;
  imageMissing = false;
  buildOut = "Step 1/9 : FROM node\nSuccessfully built abc";
  containerLogs = { stdout: "2026-01-01T00:00:00Z listening", stderr: "" };

  exec: Exec = async (argv, opts = {}) => {
    this.calls.push({ argv, opts });
    const ok = (stdout = "", stderr = ""): ExecResult => ({ code: 0, stdout, stderr });
    const [cmd, sub, sub2] = argv;
    if (cmd === "docker" && sub === "network" && sub2 === "inspect") return this.networks.has(argv[3] ?? "") ? ok() : { code: 1, stdout: "", stderr: "No such network" };
    if (cmd === "docker" && sub === "network" && sub2 === "create") { this.networks.add(argv[argv.length - 1] ?? ""); return ok("netid"); }
    if (cmd === "docker" && sub === "build") return this.buildCode === 0 ? ok(this.buildOut) : { code: this.buildCode, stdout: "", stderr: "npm ERR! missing script: build" };
    if (cmd === "docker" && sub === "tag") { this.cacheTags.push((argv[3] ?? "").split(":")[1] ?? ""); return ok(); }
    if (cmd === "docker" && sub === "image" && sub2 === "ls") return ok(this.cacheTags.join("\n"));
    if (cmd === "docker" && sub === "image" && sub2 === "inspect") return this.imageMissing ? { code: 1, stdout: "", stderr: "No such image" } : ok(this.exposed);
    if (cmd === "docker" && sub === "rmi") { const tag = (argv[2] ?? "").split(":")[1] ?? ""; this.cacheTags = this.cacheTags.filter((t) => t !== tag); return ok(); }
    if (cmd === "docker" && sub === "rm") return ok();
    if (cmd === "docker" && sub === "run") return this.runCode === 0 ? ok("4f1c0de5a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c\n") : { code: this.runCode, stdout: "", stderr: "docker: Error response from daemon: port is already allocated" };
    if (cmd === "docker" && sub === "logs") return ok(this.containerLogs.stdout, this.containerLogs.stderr);
    return { code: 127, stdout: "", stderr: `unexpected ${argv.join(" ")}` };
  };

  of(sub: string): Call[] { return this.calls.filter((c) => c.argv[0] === "docker" && c.argv[1] === sub); }
}

function source(files: Record<string, string>, extra: { commit?: string; pullRequest?: number } = {}): { fetch: FetchSource; cleaned: () => number; dirs: string[] } {
  let cleaned = 0;
  const dirs: string[] = [];
  const fetch: FetchSource = async () => {
    const dir = repo(files);
    dirs.push(dir);
    return { dir, commit: extra.commit ?? "a".repeat(40), ...(extra.pullRequest === undefined ? {} : { pullRequest: extra.pullRequest }), cleanup: () => { cleaned += 1; fs.rmSync(dir, { recursive: true, force: true }); } };
  };
  return { fetch, cleaned: () => cleaned, dirs };
}

const REQ: BuildRequest = { siteId: "sit_abc123", deploymentId: "dpl_def456", kind: "site", repoUrl: "https://github.com/acme/harbor.git", folderId: null, branch: "main" };
const NODE_SITE = { "package.json": pkg({ scripts: { start: "node server.js", build: "echo built" } }), "package-lock.json": "{}", "server.js": "x" };

function argValues(argv: string[], flag: string): string[] {
  return argv.flatMap((a, i) => (a === flag ? [argv[i + 1] ?? ""] : []));
}

// ---- detection ----------------------------------------------------------------------------------------------

test("images: the four standard Dockerfiles exist and take the build args the driver passes", () => {
  for (const name of ["Dockerfile.node", "Dockerfile.python", "Dockerfile.static", "Dockerfile.static-build"]) {
    const text = fs.readFileSync(path.join(BUILDERS_DIR, name), "utf8");
    assert.match(text, /^FROM /m, name);
    assert.match(text, /EXPOSE 3000/, name);
  }
  for (const name of ["Dockerfile.node", "Dockerfile.python", "Dockerfile.static-build"]) {
    const text = fs.readFileSync(path.join(BUILDERS_DIR, name), "utf8");
    assert.match(text, /ARG LOCK_HASH/, `${name} keys its install layer on the lockfile hash`);
    assert.match(text, /echo "lock \$\{LOCK_HASH\}"[^\n]*INSTALL_CMD/, `${name} uses LOCK_HASH in the install RUN`);
  }
});

test("detect: the repo's own Dockerfile wins over everything", async () => {
  const p = await plan({ Dockerfile: "FROM scratch\n", "package.json": pkg({ scripts: { start: "x" } }), "index.html": "<p>" });
  assert.equal(p.kind, "dockerfile");
  assert.match(p.dockerfile, /Dockerfile$/);
  assert.deepEqual(p.args, {});
  assert.ok(p.lockFiles.includes("Dockerfile"));
});

test("detect: node picks the install command from the lockfile and starts with npm start", async () => {
  const base = { "package.json": pkg({ scripts: { start: "node a.js", build: "tsc" } }) };
  const npm = await plan({ ...base, "package-lock.json": "{}" });
  assert.equal(npm.kind, "node");
  assert.equal(npm.args.INSTALL_CMD, "npm ci");
  assert.equal(npm.args.BUILD_CMD, "npm run build");
  assert.equal(npm.args.START_CMD, "npm start");
  assert.equal((await plan({ ...base, "pnpm-lock.yaml": "x" })).args.INSTALL_CMD, "corepack enable && pnpm install --frozen-lockfile");
  assert.equal((await plan({ ...base, "yarn.lock": "x" })).args.INSTALL_CMD, "corepack enable && yarn install --frozen-lockfile");
  assert.equal((await plan(base)).args.INSTALL_CMD, "npm install");
  assert.equal((await plan({ "package.json": pkg({ scripts: { start: "x" } }) })).args.BUILD_CMD, "");
});

test("detect: node falls back to main, and a Procfile web line beats both", async () => {
  assert.equal((await plan({ "package.json": pkg({ main: "srv.js" }), "srv.js": "x" })).args.START_CMD, "node srv.js");
  assert.match(await planError({ "package.json": pkg({ main: "gone.js" }) }), /no start script/, "a main file that is not there does not count");
  const withProc = await plan({ "package.json": pkg({ scripts: { start: "node a.js" } }), Procfile: "worker: node w.js\nweb: node web.js --x\n" });
  assert.equal(withProc.args.START_CMD, "node web.js --x");
});

test("detect: a build script with no start is a static site, and the output folder follows the generator", async () => {
  const vite = await plan({ "package.json": pkg({ scripts: { build: "vite build" }, devDependencies: { vite: "^5" } }) });
  assert.equal(vite.kind, "static-build");
  assert.equal(vite.args.STATIC_DIR, "dist");
  assert.equal((await plan({ "package.json": pkg({ scripts: { build: "x" }, dependencies: { "react-scripts": "5" } }) })).args.STATIC_DIR, "build");
  assert.equal((await plan({ "package.json": pkg({ scripts: { build: "x" }, devDependencies: { "@11ty/eleventy": "2" } }) })).args.STATIC_DIR, "_site");
  assert.equal((await plan({ "package.json": pkg({ scripts: { build: "x" }, dependencies: { next: "15" } }) })).args.STATIC_DIR, "out");
});

test("detect: a node project with nothing to run says what to add", async () => {
  assert.match(await planError({ "package.json": pkg({ name: "x" }) }), /no start script.*Procfile/);
  assert.match(await planError({ "package.json": "{not json" }), /not valid JSON/);
});

test("detect: python from requirements.txt or pyproject, with the entry file or Procfile as the start", async () => {
  const req = await plan({ "requirements.txt": "flask\n", "app.py": "x" });
  assert.equal(req.kind, "python");
  assert.equal(req.args.INSTALL_CMD, "pip install --no-cache-dir -r requirements.txt");
  assert.equal(req.args.START_CMD, "python app.py");
  const proj = await plan({ "pyproject.toml": "[project]\nname='x'\n", "main.py": "x" });
  assert.equal(proj.args.INSTALL_CMD, "true");
  assert.equal(proj.args.BUILD_CMD, "pip install --no-cache-dir .");
  assert.equal((await plan({ "requirements.txt": "django\n", "manage.py": "x" })).args.START_CMD, "python manage.py runserver 0.0.0.0:$PORT");
  assert.equal((await plan({ "requirements.txt": "x\n", Procfile: "web: gunicorn app:app -b 0.0.0.0:$PORT" })).args.START_CMD, "gunicorn app:app -b 0.0.0.0:$PORT");
  assert.match(await planError({ "requirements.txt": "x\n" }), /Add app\.py or main\.py/);
});

test("detect: static files from the root or the first folder that has an index.html", async () => {
  assert.equal((await plan({ "index.html": "<p>" })).args.STATIC_DIR, ".");
  assert.equal((await plan({ "public/index.html": "<p>" })).args.STATIC_DIR, "public");
  assert.equal((await plan({ "dist/index.html": "<p>", "build/index.html": "<p>" })).args.STATIC_DIR, "dist");
  assert.equal((await plan({ "index.html": "<p>", "public/index.html": "<p>" })).args.STATIC_DIR, ".");
  assert.match(await planError({ "README.md": "hi" }), /Could not tell how to build/);
});

test("procfile: only the web line counts", () => {
  const dir = repo({ Procfile: "release: x\nweb:   node s.js  \n" });
  assert.equal(procfileWeb(dir), "node s.js");
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(procfileWeb(os.tmpdir() + "/does-not-exist-vyre"), null);
});

test("cache key: the lockfile hash changes with a lockfile and ignores source edits", async () => {
  const a = await plan({ ...NODE_SITE });
  const sameLock = await plan({ ...NODE_SITE, "server.js": "edited" });
  const newLock = await plan({ ...NODE_SITE, "package-lock.json": '{"lockfileVersion":3}' });
  assert.match(a.lockHash, /^[0-9a-f]{16}$/);
  assert.equal(sameLock.lockHash, a.lockHash);
  assert.notEqual(newLock.lockHash, a.lockHash);
  assert.deepEqual(a.lockFiles, ["package.json", "package-lock.json"]);
});

test("dockerignore: keeps .git, node_modules and env files out, keeps the repo's own lines, and is idempotent", () => {
  const dir = repo({ ".dockerignore": "tmp\n.git" });
  ensureDockerignore(dir);
  const once = fs.readFileSync(path.join(dir, ".dockerignore"), "utf8");
  assert.deepEqual(once.trim().split("\n"), ["tmp", ".git", "node_modules", ".env", ".env.*", ".DS_Store"]);
  ensureDockerignore(dir);
  assert.equal(fs.readFileSync(path.join(dir, ".dockerignore"), "utf8"), once);
  const none = repo({});
  ensureDockerignore(none);
  assert.match(fs.readFileSync(path.join(none, ".dockerignore"), "utf8"), /^\.git\nnode_modules\n/);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(none, { recursive: true, force: true });
});

test("names: ids become lowercase docker names and anything that could be an option is refused", () => {
  assert.equal(imageName("sit_ABC123", "dpl_Def"), "vyre-site/sit_abc123:dpl_def");
  assert.equal(cacheName("sit_abc", "0123456789abcdef"), "vyre-site-cache/sit_abc:0123456789abcdef");
  for (const bad of ["-rf", "a b", "a/b", "", "a;b", "$(x)", "x".repeat(200)]) assert.throws(() => safeName(bad, "thing"), BuildPlanError, bad);
});

test("exposedPort: the lowest tcp port, else 3000", () => {
  assert.equal(exposedPort('{"8080/tcp":{},"80/tcp":{}}'), 80);
  assert.equal(exposedPort('{"5353/udp":{}}'), 3000);
  assert.equal(exposedPort("null"), 3000);
  assert.equal(exposedPort("not json"), 3000);
  assert.equal(exposedPort("{}"), 3000);
});

test("pullRequestOf: pr-12 and pull/12/head are pull requests, branches are not", () => {
  assert.equal(pullRequestOf("pr-12"), 12);
  assert.equal(pullRequestOf("pull/7/head"), 7);
  assert.equal(pullRequestOf("feature/pr-12"), undefined);
  assert.equal(pullRequestOf("main"), undefined);
});

// ---- build --------------------------------------------------------------------------------------------------

test("build: standard Dockerfile, lockfile hash as a build arg and cache source, labels, cache tag after", async () => {
  const docker = new FakeDocker();
  const src = source(NODE_SITE, { commit: "c".repeat(40) });
  const rt = dockerRuntime({ exec: docker.exec, fetchSource: src.fetch, envValue: async () => "" });
  const res = await rt.build(REQ);
  assert.equal(res.ok, true);
  assert.equal(res.image, "vyre-site/sit_abc123:dpl_def456");
  assert.equal(res.commit, "c".repeat(40));
  assert.equal(res.pullRequest, undefined);
  assert.match(res.log[0] ?? "", /Detected node/);
  assert.ok(res.log.some((l) => l.includes("Built vyre-site/sit_abc123:dpl_def456")));
  const b = docker.of("build")[0]!.argv;
  assert.equal(argValues(b, "--file")[0], path.join(BUILDERS_DIR, "Dockerfile.node"));
  assert.deepEqual(argValues(b, "--tag"), ["vyre-site/sit_abc123:dpl_def456"]);
  const args = argValues(b, "--build-arg");
  const hash = args.find((a) => a.startsWith("LOCK_HASH="))!.slice("LOCK_HASH=".length);
  assert.match(hash, /^[0-9a-f]{16}$/);
  assert.ok(args.includes("INSTALL_CMD=npm ci"));
  assert.ok(args.includes("START_CMD=npm start"));
  assert.deepEqual(argValues(b, "--cache-from"), [`vyre-site-cache/sit_abc123:${hash}`]);
  assert.deepEqual(argValues(b, "--label"), ["vyre.site=sit_abc123", "vyre.deployment=dpl_def456", "vyre.port=3000"], "the port Dockerfile.node declares is kept as a label for start()");
  assert.deepEqual(docker.cacheTags, [hash]);
  assert.equal(src.cleaned(), 1, "the checkout is removed");
  assert.equal(fs.existsSync(src.dirs[0]!), false);
});

test("build: the layer cache moves with the lockfile hash and older cache tags are removed", async () => {
  const docker = new FakeDocker();
  docker.cacheTags = ["oldoldoldoldold1"];
  const rt = dockerRuntime({ exec: docker.exec, fetchSource: source(NODE_SITE).fetch, envValue: async () => "" });
  await rt.build(REQ);
  const hash = argValues(docker.of("build")[0]!.argv, "--build-arg").find((a) => a.startsWith("LOCK_HASH="))!.slice(10);
  assert.deepEqual(docker.of("rmi").map((c) => c.argv[2]), ["vyre-site-cache/sit_abc123:oldoldoldoldold1"]);
  assert.deepEqual(docker.cacheTags, [hash]);
  // the same lockfile again: same key, nothing else to remove
  docker.calls = [];
  await dockerRuntime({ exec: docker.exec, fetchSource: source({ ...NODE_SITE, "server.js": "edited" }).fetch, envValue: async () => "" }).build(REQ);
  assert.equal(argValues(docker.of("build")[0]!.argv, "--build-arg").find((a) => a.startsWith("LOCK_HASH="))!.slice(10), hash);
  assert.equal(docker.of("rmi").length, 0);
});

test("build: the repo's own Dockerfile is built as is, with no site build args", async () => {
  const docker = new FakeDocker();
  const rt = dockerRuntime({ exec: docker.exec, fetchSource: source({ Dockerfile: "FROM scratch\n" }).fetch, envValue: async () => "" });
  const res = await rt.build(REQ);
  assert.equal(res.ok, true);
  const b = docker.of("build")[0]!.argv;
  assert.match(argValues(b, "--file")[0] ?? "", /vyre-builders-test-[^/]+\/Dockerfile$/);
  assert.deepEqual(argValues(b, "--build-arg").filter((a) => !a.startsWith("LOCK_HASH=") && !a.startsWith("BUILDKIT")), []);
});

test("build: a pull request source reports its number", async () => {
  const docker = new FakeDocker();
  const rt = dockerRuntime({ exec: docker.exec, fetchSource: source(NODE_SITE, { pullRequest: 12 }).fetch, envValue: async () => "" });
  assert.equal((await rt.build({ ...REQ, branch: "pr-12" })).pullRequest, 12);
});

test("build: a failing docker build returns the lines that say why and leaves no cache tag", async () => {
  const docker = new FakeDocker();
  docker.buildCode = 1;
  const src = source(NODE_SITE);
  const res = await dockerRuntime({ exec: docker.exec, fetchSource: src.fetch, envValue: async () => "" }).build(REQ);
  assert.equal(res.ok, false);
  assert.equal(res.image, undefined);
  assert.ok(res.log.some((l) => l.includes("missing script: build")));
  assert.match(res.log[res.log.length - 1] ?? "", /The build failed/);
  assert.equal(docker.of("tag").length, 0);
  assert.equal(src.cleaned(), 1);
});

test("build: a timeout says so in plain words", async () => {
  const docker = new FakeDocker();
  docker.buildCode = 124;
  const res = await dockerRuntime({ exec: docker.exec, fetchSource: source(NODE_SITE).fetch, envValue: async () => "" }).build(REQ);
  assert.equal(res.ok, false);
  assert.match(res.log[res.log.length - 1] ?? "", /ran out of time/);
});

test("build: an undetectable repo, a failed fetch and an unsafe id each fail the build without throwing, and no docker build runs", async () => {
  const docker = new FakeDocker();
  const none = await dockerRuntime({ exec: docker.exec, fetchSource: source({ "README.md": "x" }).fetch, envValue: async () => "" }).build(REQ);
  assert.equal(none.ok, false);
  assert.match(none.log.join("\n"), /Could not tell how to build/);
  const failFetch: FetchSource = async () => { throw new BuildPlanError("git failed: repository not found"); };
  const gone = await dockerRuntime({ exec: docker.exec, fetchSource: failFetch, envValue: async () => "" }).build(REQ);
  assert.match(gone.log.join("\n"), /repository not found/);
  const unsafe = await dockerRuntime({ exec: docker.exec, fetchSource: source(NODE_SITE).fetch, envValue: async () => "" }).build({ ...REQ, siteId: "--privileged" });
  assert.equal(unsafe.ok, false);
  assert.equal(docker.of("build").length, 0);
});

test("build: a long log keeps the last 200 lines and says how many were left out", async () => {
  const docker = new FakeDocker();
  docker.buildOut = Array.from({ length: 450 }, (_, i) => `line ${i}`).join("\n");
  const res = await dockerRuntime({ exec: docker.exec, fetchSource: source(NODE_SITE).fetch, envValue: async () => "" }).build(REQ);
  assert.equal(res.ok, true);
  assert.equal(res.log.length, 201);
  assert.match(res.log[0] ?? "", /earlier lines left out/);
  assert.ok(res.log.some((l) => l === "line 449"));
});

// ---- start, stop, logs --------------------------------------------------------------------------------------

const START = { siteId: "sit_abc123", deploymentId: "dpl_def456", env: "staging" as const, image: "vyre-site/sit_abc123:dpl_def456", network: "vyre-sites", name: "site-abc123-def456", envRefs: [] as { name: string; ref: string }[], servicePrincipal: "svc_site_abc123" };

test("start: creates the network once, drops capabilities, caps memory and processes, and returns name:port", async () => {
  const docker = new FakeDocker();
  const rt = dockerRuntime({ exec: docker.exec, fetchSource: source(NODE_SITE).fetch, envValue: async () => "" });
  const out = await rt.start(START);
  assert.deepEqual(out, { containerId: "4f1c0de5a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c", upstream: "site-abc123-def456:3000" });
  assert.equal(docker.of("network").filter((c) => c.argv[2] === "create").length, 1);
  const run = docker.of("run")[0]!.argv;
  assert.equal(argValues(run, "--network")[0], "vyre-sites");
  assert.equal(argValues(run, "--name")[0], "site-abc123-def456");
  assert.deepEqual(argValues(run, "--cap-drop"), ["ALL"]);
  assert.deepEqual(argValues(run, "--security-opt"), ["no-new-privileges"]);
  assert.deepEqual(argValues(run, "--memory"), ["512m"]);
  assert.deepEqual(argValues(run, "--pids-limit"), ["256"]);
  assert.ok(!run.includes("--privileged") && !run.includes("-p") && !run.includes("--publish"), "no published ports: only Caddy on the network reaches it");
  assert.ok(argValues(run, "--env").includes("VYRE_SERVICE_PRINCIPAL=svc_site_abc123"));
  assert.equal(run[run.length - 2], "--");
  assert.equal(run[run.length - 1], START.image);
  // a second start finds the network
  await rt.start({ ...START, name: "site-abc123-other" });
  assert.equal(docker.of("network").filter((c) => c.argv[2] === "create").length, 1);
});

test("start: the port comes from the image (EXPOSE) and becomes PORT", async () => {
  const docker = new FakeDocker();
  docker.exposed = '{"8080/tcp":{}}';
  const out = await dockerRuntime({ exec: docker.exec, fetchSource: source(NODE_SITE).fetch, envValue: async () => "" }).start(START);
  assert.equal(out.upstream, "site-abc123-def456:8080");
  assert.ok(argValues(docker.of("run")[0]!.argv, "--env").includes("PORT=8080"));
});

test("start: environment values go through the child environment, never argv", async () => {
  const docker = new FakeDocker();
  const refs: string[] = [];
  const rt = dockerRuntime({ exec: docker.exec, fetchSource: source(NODE_SITE).fetch, envValue: async (ref) => { refs.push(ref); return ref === "dpl:STRIPE_KEY" ? "sk_live_SECRET" : "postgres://u:p@h/d"; } });
  await rt.start({ ...START, envRefs: [{ name: "STRIPE_KEY", ref: "dpl:STRIPE_KEY" }, { name: "DB_URL", ref: "dpl:DB_URL" }] });
  assert.deepEqual(refs, ["dpl:STRIPE_KEY", "dpl:DB_URL"]);
  const call = docker.of("run")[0]!;
  assert.deepEqual(call.opts.env, { STRIPE_KEY: "sk_live_SECRET", DB_URL: "postgres://u:p@h/d" });
  assert.ok(argValues(call.argv, "--env").includes("STRIPE_KEY") && argValues(call.argv, "--env").includes("DB_URL"));
  for (const c of docker.calls) assert.ok(!c.argv.join(" ").includes("SECRET") && !c.argv.join(" ").includes("postgres://"), "no value in any argv");
});

test("start: refuses a bad variable name, a missing image, a failed run and a bad name, each with a sentence", async () => {
  const mk = (d: FakeDocker) => dockerRuntime({ exec: d.exec, fetchSource: source(NODE_SITE).fetch, envValue: async () => "v" });
  await assert.rejects(mk(new FakeDocker()).start({ ...START, envRefs: [{ name: "A=B", ref: "r" }] }), /not a valid environment variable name/);
  const missing = new FakeDocker();
  missing.imageMissing = true;
  await assert.rejects(mk(missing).start(START), /not on this server/);
  const failing = new FakeDocker();
  failing.runCode = 125;
  await assert.rejects(mk(failing).start(START), /did not start: .*port is already allocated/);
  await assert.rejects(mk(new FakeDocker()).start({ ...START, name: "--rm" }), /Unsafe/);
  await assert.rejects(mk(new FakeDocker()).start({ ...START, image: "--privileged" }), /Unsafe image/);
});

test("stop and logs: ids that are not container ids are ignored, logs are clamped", async () => {
  const docker = new FakeDocker();
  const rt = dockerRuntime({ exec: docker.exec, fetchSource: source(NODE_SITE).fetch, envValue: async () => "" });
  await rt.stop("--all");
  await rt.stop("ctr_1");
  assert.equal(docker.of("rm").length, 0);
  await rt.stop("4f1c0de5a1b2");
  assert.deepEqual(docker.of("rm")[0]!.argv, ["docker", "rm", "--force", "4f1c0de5a1b2"]);
  assert.deepEqual(await rt.logs("--x", 10), []);
  docker.containerLogs = { stdout: "a\nb", stderr: "c" };
  assert.deepEqual(await rt.logs("4f1c0de5a1b2", 2), ["b", "c"]);
  await rt.logs("4f1c0de5a1b2", 99999);
  assert.deepEqual(argValues(docker.of("logs").pop()!.argv, "--tail"), ["1000"]);
});

// ---- git source ---------------------------------------------------------------------------------------------

test("gitSource: shallow clone of the branch, with -- before the address; the checkout is removed on a failure", async () => {
  const calls: string[][] = [];
  const exec: Exec = async (argv) => { calls.push(argv); return argv[1] === "rev-parse" ? { code: 0, stdout: `${"d".repeat(40)}\n`, stderr: "" } : { code: 0, stdout: "", stderr: "" }; };
  const s = await gitSource(exec)(REQ);
  assert.deepEqual(calls[0], ["git", "clone", "--depth", "1", "--branch", "main", "--", "https://github.com/acme/harbor.git", "."]);
  assert.equal(s.commit, "d".repeat(40));
  assert.equal(s.pullRequest, undefined);
  s.cleanup();
  assert.equal(fs.existsSync(s.dir), false);

  const pr = await gitSource(exec)({ ...REQ, branch: "pr-12" });
  assert.equal(pr.pullRequest, 12);
  assert.ok(calls.some((c) => c.join(" ") === "git fetch --depth 1 -- https://github.com/acme/harbor.git refs/pull/12/head"));
  pr.cleanup();

  let made = "";
  const failing: Exec = async (argv, o) => { made = o?.cwd ?? ""; return argv[1] === "clone" ? { code: 128, stdout: "", stderr: "fatal: Remote branch nope not found\n" } : { code: 0, stdout: "", stderr: "" }; };
  await assert.rejects(gitSource(failing)({ ...REQ, branch: "nope" }), /Remote branch nope not found/);
  assert.equal(fs.existsSync(made), false, "no checkout left behind");
});

test("gitSource: refuses a missing repo, a local path, an option-like address and an option-like branch", async () => {
  const exec: Exec = async () => ({ code: 0, stdout: "", stderr: "" });
  await assert.rejects(gitSource(exec)({ ...REQ, repoUrl: null }), /no repository/);
  for (const url of ["/etc", "file:///etc", "--upload-pack=x", "http://insecure.example/r.git", "ext::sh -c x"]) await assert.rejects(gitSource(exec)({ ...REQ, repoUrl: url }), /must start with https/, url);
  await assert.rejects(gitSource(exec)({ ...REQ, branch: "--upload-pack=x" }), /branch name is not allowed/);
  const ok = await gitSource(exec)({ ...REQ, repoUrl: "git@github.com:acme/harbor.git" });
  ok.cleanup();
});

// ---- inside the sites handlers ------------------------------------------------------------------------------

test("handlers: sites.build and sites.deploy run on the Docker driver and route the container's upstream", async () => {
  const w = harness();
  const docker = new FakeDocker();
  const src = source(NODE_SITE);
  configureSites({ ...w.drivers, runtime: dockerRuntime({ exec: docker.exec, fetchSource: src.fetch, envValue: async () => "" }) });
  type Fn = (ctx: Ctx, input: unknown) => Promise<unknown>;
  const call = async <T>(cap: keyof typeof handlers, input: unknown): Promise<T> => (await (handlers[cap] as Fn)(w.ctx, input)) as T;
  const { site } = await call<{ site: { siteId: string } }>("sites.create", { name: "Harbor", kind: "site", idempotencyKey: "k1", repoUrl: "https://github.com/acme/harbor.git" });
  await call("sites.staging_password_set", { siteId: site.siteId, vaultHandle: "#Staging_Pass" });
  const built = await call<{ deploymentId: string }>("sites.build", { siteId: site.siteId });
  const dep = await call<{ deployment: { state: string; url?: string } }>("sites.deploy", { siteId: site.siteId, deploymentId: built.deploymentId });
  assert.equal(dep.deployment.state, "ready");
  assert.equal(docker.of("build").length, 1);
  assert.equal(docker.of("run").length, 1);
  const routed = [...w.router.routes.values()];
  assert.equal(routed.length, 1);
  assert.match(routed[0]?.upstream ?? "", /^site-[a-z0-9]+-[a-z0-9]+:3000$/);
  assert.notEqual(routed[0]?.auth, null, "staging is routed only with its sealed password");
  assert.equal(argValues(docker.of("run")[0]!.argv, "--network")[0], "vyre-sites");
  configureSites(null);
});

test("handlers: a build that cannot be detected fails the deployment with the reason, and no container starts", async () => {
  const w = harness();
  const docker = new FakeDocker();
  configureSites({ ...w.drivers, runtime: dockerRuntime({ exec: docker.exec, fetchSource: source({ "README.md": "x" }).fetch, envValue: async () => "" }) });
  type Fn = (ctx: Ctx, input: unknown) => Promise<unknown>;
  const call = async <T>(cap: keyof typeof handlers, input: unknown): Promise<T> => (await (handlers[cap] as Fn)(w.ctx, input)) as T;
  const { site } = await call<{ site: { siteId: string } }>("sites.create", { name: "Empty", kind: "site", idempotencyKey: "k2", repoUrl: "https://github.com/acme/empty.git" });
  await call("sites.build", { siteId: site.siteId });
  assert.ok(w.names().includes("site.build_failed"));
  assert.match(JSON.stringify(w.events.find((e) => e.name === "site.build_failed")?.payload), /Could not tell how to build/);
  assert.equal(docker.of("run").length, 0);
  configureSites(null);
});
