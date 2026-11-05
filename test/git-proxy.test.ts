// The Vyre git proxy against real git: a real `git clone`, `git fetch` and `git push` go through the proxy to a stand-in GitHub that serves real bare repositories (helpers/fake-github-git.ts).
// Real: git on both ends, the proxy, the engine's session environment (githubEnv). Scripted: the Space's answers (policy, the Gate's hold, the filler) and the Gate's events.
// @reads /host/src/seams/git-proxy.ts
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createGitProxy } from "../host/src/seams/git-proxy.ts";
import { GIT_LOCAL_HOST, githubEnv } from "../modules/engine/github-session.ts";
import { createEgressProxy } from "../sandbox/src/egress.ts";
import { fakeGithubGit } from "../host/tests/helpers/fake-github-git.ts";
import type { FakeGit } from "../host/tests/helpers/fake-github-git.ts";

type Mode = "always" | "ask" | "never";
const REPO = "vyre-ai/website";
const PERSON = "usr_maya";

interface World {
  gh: FakeGit; base: string; env: Record<string, string>; modes: Record<string, Mode>; posts: Array<Record<string, unknown>>; calls: Array<{ cap: string; input: Record<string, unknown>; seed: Record<string, unknown> }>;
  holds: Map<string, { repo: string; action: string; consumer: string }>; proxy: ReturnType<typeof createGitProxy>; token: string; end: () => void; tmp: string;
  approve(taskId: string): void; deny(taskId: string): void; held(): string[]; waitHeld(n?: number): Promise<string>; clone(name?: string): Promise<string>; run(cwd: string, ...args: string[]): Promise<{ code: number; out: string }>;
  commit(cwd: string, file: string, text?: string): Promise<string>; close(): Promise<void>;
}

async function world(o: { modes?: Partial<Record<string, Mode>>; branch?: string; parkMs?: number; scope?: string[]; wall?: boolean } = {}): Promise<World> {
  const gh = await fakeGithubGit([REPO], o.branch ?? "main");
  const modes: Record<string, Mode> = { read: "always", push_branch: "always", push_default: "ask", open_pr: "ask", comment: "ask", merge: "ask", ...o.modes };
  const grants = new Set<string>(), holds = new Map<string, { repo: string; action: string; consumer: string }>(), fills = new Map<string, string>();
  const events: Array<{ seq: number; name: string; payload: Record<string, unknown> }> = [];
  const posts: Array<Record<string, unknown>> = [], calls: World["calls"] = [];
  let n = 0;
  const ok = (output: unknown) => ({ status: "ok" as const, output, traceId: "t" });
  const invoke = async (cap: string, input: unknown, seed: unknown) => {
    const i = input as Record<string, string>;
    calls.push({ cap, input: i, seed: seed as Record<string, unknown> });
    if (cap === "identity.whoami") return ok({ name: "Maya Chen" });
    if (cap === "github.me.policy.get") return ok({ policy: modes });
    if (cap === "chat.post") { posts.push(i); return ok({}); }
    if (cap === "github.me.approve") { const taskId = `tsk_${++n}`; holds.set(taskId, { repo: i["repo"]!, action: i["action"]!, consumer: i["consumer"]! }); return { status: "held" as const, taskId, traceId: "t" }; }
    if (cap === "github.token") {
      const mode = modes[i["action"]!];
      if (mode === "never") throw { error: { code: "validation.precondition_failed", message: `You set GitHub to never let anything ${i["action"] === "push_default" ? "push to the default branch" : "push a branch"}. Change it in Settings, GitHub.` } };
      const once = /^git\.push:[0-9a-f]{16}$/.test(i["consumer"]!), gkey = once ? `${i["repo"]}#${i["consumer"]}|${i["action"]}` : `${i["repo"]}|${i["action"]}`;
      const had = grants.has(gkey);
      if (once) grants.delete(gkey);
      if (mode === "ask" && !had) { const taskId = `tsk_${++n}`; holds.set(taskId, { repo: i["repo"]!, action: i["action"]!, consumer: i["consumer"]! }); return { status: "held" as const, taskId, traceId: "t" }; }
      const handle = `#h${++n}`, token = `ghs_${i["action"] === "read" ? "read" : "write"}_${n}`;
      gh.tokens.set(token, i["action"] === "read" ? "read" : "write");
      fills.set(handle, token);
      return ok({ handle, expiresAt: Date.now() + 3_600_000, repo: i["repo"], permissions: {} });
    }
    throw new Error(`no ${cap}`);
  };
  let base = "";
  const proxy = createGitProxy({
    space: "spc_t", invoke: invoke as never, fill: (h) => { const t = fills.get(h) ?? null; fills.delete(h); return t; }, upstream: gh.url, base: () => base,
    parkMs: o.parkMs ?? 30_000, keepAliveMs: 150, pollMs: 15,
    gate: { head: async () => events.length, since: async (seq) => events.filter((e) => e.seq > seq) },
  });
  // a short request timeout, checked often: a parked push must survive it (its body is spooled while it waits)
  const server = http.createServer({ requestTimeout: 2_000, connectionsCheckingInterval: 200 }, (q, r) => { if (!proxy.handle(q, r)) { r.writeHead(404); r.end("no"); } });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const call = async (cap: string): Promise<unknown> => {
    if (cap === "threads.get") return { thread: { scopeType: "project", scopeId: "prj_site" } };
    if (cap === "projects.get") return { project: { folderId: "fld_site" } };
    if (cap === "git.status") return { remotes: (o.scope ?? [REPO]).map((r) => ({ url: `https://github.com/${r}.git` })) };
    if (cap === "github.me.status") return { connected: true, needsReconnect: false };
    throw new Error(`no ${cap}`);
  };
  // wall: the engine reaches the Space only through an egress proxy that answers the git name itself (sandbox/src/egress.ts), as a walled engine does through its unix socket; the Space has no public address
  const wallProxy = o.wall ? createEgressProxy({ allow: [], rule: { egress: "list", allow: [] }, local: () => ({ host: GIT_LOCAL_HOST, handle: (q, r) => proxy.handle(q, r) }) }) : null;
  const wallPort = wallProxy ? (await wallProxy.listen()).port : 0;
  const made = await githubEnv({ call, git: proxy.port }, PERSON, "thr_1", "agt_coder", o.wall ? "socket" : "address");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-gitproxy-"));
  const env = { PATH: process.env["PATH"] ?? "", HOME: tmp, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", GIT_TERMINAL_PROMPT: "0", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t", ...(wallProxy ? { http_proxy: `http://127.0.0.1:${wallPort}`, HTTP_PROXY: `http://127.0.0.1:${wallPort}` } : {}), ...made.env };
  const run = (cwd: string, ...args: string[]) => new Promise<{ code: number; out: string }>((done) => {
    const p = spawn("git", args, { cwd, env });
    let out = "";
    p.stdout.on("data", (c) => { out += String(c); });
    p.stderr.on("data", (c) => { out += String(c); });
    p.on("close", (code) => done({ code: code ?? -1, out }));
  });
  let seq = 0;
  const w: World = {
    gh, base, env, modes, posts, calls, holds, proxy, tmp, end: made.end, token: made.env["VYRE_GIT_TOKEN"]!, run,
    approve(taskId) { const h = holds.get(taskId)!; grants.add(/^git\.push:/.test(h.consumer) ? `${h.repo}#${h.consumer}|${h.action}` : `${h.repo}|${h.action}`); events.push({ seq: ++seq, name: "gate.approved", payload: { taskId } }); },
    deny(taskId) { events.push({ seq: ++seq, name: "gate.denied", payload: { taskId, mode: "drop" } }); },
    held: () => [...holds.keys()],
    async waitHeld(count = 1) {
      for (let k = 0; k < 600; k++) { if (holds.size >= count && posts.length >= count) return [...holds.keys()][count - 1]!; await new Promise((r) => setTimeout(r, 20)); }
      throw new Error("no push was held");
    },
    async clone(name = "work") {
      const dir = path.join(tmp, name);
      const r = await run(tmp, "clone", `https://github.com/${REPO}.git`, dir);
      assert.equal(r.code, 0, r.out);
      return dir;
    },
    async commit(cwd, file, text = "x\n") { fs.writeFileSync(path.join(cwd, file), text + Math.random()); await run(cwd, "add", "."); const r = await run(cwd, "commit", "-m", `add ${file}`); assert.equal(r.code, 0, r.out); return (await run(cwd, "rev-parse", "HEAD")).out.trim(); },
    async close() { made.end(); await wallProxy?.close(); server.closeAllConnections?.(); await new Promise<void>((done) => server.close(() => done())); await gh.close(); fs.rmSync(tmp, { recursive: true, force: true }); },
  };
  return w;
}

/** Pushes that reached GitHub with a write token. The advertisement a push starts with also takes one, and changes nothing. */
const landed = (w: World): number => w.gh.writes().filter((s) => s.method === "POST").length;
const withWorld = async (o: Parameters<typeof world>[0], f: (w: World) => Promise<void>): Promise<void> => { const w = await world(o); try { await f(w); } finally { await w.close(); } };
const T = { timeout: 90_000 };

test("the session holds a proxy token and no GitHub token, and git is sent to the Space", T, () => withWorld({}, async (w) => {
  assert.match(w.token, /^vgp_/);
  for (const [k, v] of Object.entries(w.env)) assert.equal(/gh[pousr]_/.test(v) || k === "GH_TOKEN" || k === "GITHUB_TOKEN", false, k);
  const dir = await w.clone();
  assert.equal(fs.readFileSync(path.join(dir, "README.md"), "utf8"), "# site\n", "a clone works");
  const cfg = await w.run(dir, "config", "--show-origin", "--get-all", "remote.origin.url");
  assert.match(cfg.out, /github\.com\/vyre-ai\/website\.git/, "the remote still says GitHub");
  assert.equal(w.gh.seen.every((s) => s.kind === "read"), true, "a fetch carries a read token");
  assert.equal(w.posts.length, 0);
}));

test("a branch push lands with no card and no question", T, () => withWorld({}, async (w) => {
  const dir = await w.clone();
  await w.run(dir, "checkout", "-b", "feature/x");
  const sha = await w.commit(dir, "a.txt");
  const r = await w.run(dir, "push", "origin", "feature/x");
  assert.equal(r.code, 0, r.out);
  assert.equal(w.gh.ref(REPO, "refs/heads/feature/x"), sha, "the branch is on GitHub");
  assert.equal(w.posts.length, 0, "no card");
  assert.equal(w.held().length, 0, "nothing was held");
  assert.ok(w.gh.writes().some((s) => s.path.endsWith("git-receive-pack")), "a write token made the push");
  assert.equal(w.calls.filter((c) => c.cap === "github.token" && c.input["action"] === "push_branch").length >= 1, true);
  for (const c of w.calls.filter((x) => x.cap === "github.token" || x.cap === "github.me.approve")) {
    assert.deepEqual([c.seed["principal"], c.seed["actingFor"]], [{ kind: "agent", id: "agt_coder" }, PERSON], "a token is asked for as the agent acting for the person, so the Gate can hold it");
  }
  // a new commit on the same branch, a tag, and a delete of a branch other than the default, all branch pushes
  await w.commit(dir, "b.txt");
  assert.equal((await w.run(dir, "push", "origin", "feature/x")).code, 0);
  await w.run(dir, "tag", "v1");
  assert.equal((await w.run(dir, "push", "origin", "v1")).code, 0);
  assert.ok(w.gh.ref(REPO, "refs/tags/v1"));
  assert.equal((await w.run(dir, "push", "origin", ":feature/x")).code, 0);
  assert.equal(w.gh.ref(REPO, "refs/heads/feature/x"), null);
  assert.equal(w.posts.length, 0);
}));

test("a push to the default branch is held, never lands before the yes, and lands after it", T, () => withWorld({}, async (w) => {
  const dir = await w.clone();
  const sha = await w.commit(dir, "m.txt");
  const before = w.gh.ref(REPO, "refs/heads/main");
  const push = w.run(dir, "push", "origin", "HEAD:main");
  const taskId = await w.waitHeld();
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(w.gh.ref(REPO, "refs/heads/main"), before, "not landed while it waits");
  assert.equal(landed(w), 0, "no push reached GitHub");
  assert.equal(w.posts.length, 1);
  const data = ((w.posts[0]!["blocks"] as Array<{ data: Record<string, unknown> }>)[0]!).data;
  assert.deepEqual([data["icon"], data["lead"], data["title"], data["target"]], ["approval", "Approval", "Push to main on vyre-ai/website", { type: "task", id: taskId }]);
  w.approve(taskId);
  const r = await push;
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /Waiting for Maya to approve the push to main/, "the client was told why it waits");
  assert.equal(w.gh.ref(REPO, "refs/heads/main"), sha, "landed after the yes");
}));

test("an approval is for that one push: the same push asks again, and another push asks too", T, () => withWorld({}, async (w) => {
  const dir = await w.clone();
  await w.commit(dir, "one.txt");
  const first = w.run(dir, "push", "origin", "HEAD:main");
  const t1 = await w.waitHeld();
  assert.match(w.holds.get(t1)!.consumer, /^git\.push:[0-9a-f]{16}$/, "the question names the push");
  w.approve(t1);
  assert.equal((await first).code, 0);
  // a second push to main, moments after the first was approved, asks on its own
  await w.commit(dir, "two.txt");
  const second = w.run(dir, "push", "origin", "HEAD:main");
  const t2 = await w.waitHeld(2);
  assert.notEqual(w.holds.get(t2)!.consumer, w.holds.get(t1)!.consumer, "another push, another question");
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(landed(w), 1, "nothing more landed while it waits");
  w.approve(t2);
  assert.equal((await second).code, 0);
  assert.equal(landed(w), 2);
}));

test("behind a wall, on a Space with only a loopback address: clone, branch push, and a held push to main all work through the wall's own answer", T, () => withWorld({ wall: true }, async (w) => {
  assert.equal(Object.values(w.env).some((v) => v.includes(w.base)), false, "the engine is never told the loopback address");
  assert.match(w.env["GIT_CONFIG_KEY_0"]!, /vyre-git\.invalid/);
  const dir = await w.clone();
  await w.run(dir, "checkout", "-b", "feat");
  const sha = await w.commit(dir, "a.txt");
  const r = await w.run(dir, "push", "origin", "feat");
  assert.equal(r.code, 0, r.out);
  assert.equal(w.gh.ref(REPO, "refs/heads/feat"), sha);
  const push = w.run(dir, "push", "origin", "feat:main");
  const taskId = await w.waitHeld();
  await new Promise((x) => setTimeout(x, 300));
  assert.notEqual(w.gh.ref(REPO, "refs/heads/main"), sha, "held through the wall too");
  w.approve(taskId);
  const done = await push;
  assert.equal(done.code, 0, done.out);
  assert.match(done.out, /Waiting for Maya/);
  assert.equal(w.gh.ref(REPO, "refs/heads/main"), sha);
  // and a name that is not the git address is still the wall's to refuse
  assert.equal(w.proxy.live(), 1);
}));

test("when the default branch cannot be learned the push is refused, never guessed", T, () => withWorld({}, async (w) => {
  const dir = await w.clone();
  await w.commit(dir, "m.txt");
  const before = w.gh.ref(REPO, "refs/heads/main");
  w.gh.failAdvert.on = true;
  const r = await w.run(dir, "push", "origin", "HEAD:main");
  assert.notEqual(r.code, 0);
  assert.match(r.out, /could not tell which branch is the default/);
  assert.equal(w.gh.ref(REPO, "refs/heads/main"), before);
  assert.equal(landed(w), 0);
}));

test("a no leaves GitHub untouched and git says so", T, () => withWorld({}, async (w) => {
  const dir = await w.clone();
  await w.commit(dir, "m.txt");
  const before = w.gh.ref(REPO, "refs/heads/main");
  const push = w.run(dir, "push", "origin", "HEAD:main");
  w.deny(await w.waitHeld());
  const r = await push;
  assert.notEqual(r.code, 0);
  assert.match(r.out, /rejected/, r.out);
  assert.match(r.out, /The push to main was not approved/);
  assert.equal(w.gh.ref(REPO, "refs/heads/main"), before);
  assert.equal(landed(w), 0, "no push reached GitHub with a write token");
}));

test("no answer in time leaves GitHub untouched and git says so", T, () => withWorld({ parkMs: 700 }, async (w) => {
  const dir = await w.clone();
  await w.commit(dir, "m.txt");
  const before = w.gh.ref(REPO, "refs/heads/main");
  const r = await w.run(dir, "push", "origin", "HEAD:main");
  assert.notEqual(r.code, 0);
  assert.match(r.out, /Nobody answered/);
  assert.equal(w.gh.ref(REPO, "refs/heads/main"), before);
  assert.equal(landed(w), 0);
}));

test("Never refuses in the person's words", T, () => withWorld({ modes: { push_default: "never" } }, async (w) => {
  const dir = await w.clone();
  await w.commit(dir, "m.txt");
  const r = await w.run(dir, "push", "origin", "HEAD:main");
  assert.notEqual(r.code, 0);
  assert.match(r.out, /You set GitHub to never let anything push to the default branch\. Change it in Settings, GitHub\./);
  assert.equal(w.held().length, 0, "nothing to ask: the answer is already no");
  assert.equal(landed(w), 0);
  // and a branch still goes through under the same settings
  await w.run(dir, "checkout", "-b", "ok");
  await w.commit(dir, "b.txt");
  assert.equal((await w.run(dir, "push", "origin", "ok")).code, 0);
}));

test("mixed refs are all or nothing: a held default branch keeps the branch off too", T, () => withWorld({}, async (w) => {
  const dir = await w.clone();
  await w.run(dir, "checkout", "-b", "feat");
  const sha = await w.commit(dir, "f.txt");
  const before = w.gh.ref(REPO, "refs/heads/main");
  const push = w.run(dir, "push", "origin", "feat", "feat:main");
  w.deny(await w.waitHeld());
  const r = await push;
  assert.notEqual(r.code, 0);
  assert.equal(w.gh.ref(REPO, "refs/heads/feat"), null, "the branch did not land either");
  assert.equal(w.gh.ref(REPO, "refs/heads/main"), before);
  assert.equal(landed(w), 0);
  // the same push, approved: both land
  const again = w.run(dir, "push", "origin", "feat", "feat:main");
  const second = await w.waitHeld(2);
  w.approve(second);
  assert.equal((await again).code, 0);
  assert.equal(w.gh.ref(REPO, "refs/heads/feat"), sha);
  assert.equal(w.gh.ref(REPO, "refs/heads/main"), sha);
}));

test("deleting the default branch is held even when the settings say Always", T, () => withWorld({ modes: { push_default: "always" } }, async (w) => {
  const dir = await w.clone();
  // a push to main under Always goes through with no question
  const sha = await w.commit(dir, "m.txt");
  assert.equal((await w.run(dir, "push", "origin", "HEAD:main")).code, 0);
  assert.equal(w.gh.ref(REPO, "refs/heads/main"), sha);
  assert.equal(w.held().length, 0);
  // a delete waits
  const del = w.run(dir, "push", "origin", ":main");
  const taskId = await w.waitHeld();
  assert.equal(w.holds.get(taskId)!.action, "push_default");
  assert.equal(w.posts.length, 1);
  assert.equal(((w.posts[0]!["blocks"] as Array<{ data: Record<string, unknown> }>)[0]!).data["title"], "Delete main on vyre-ai/website");
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(w.gh.ref(REPO, "refs/heads/main"), sha, "still there while it waits");
  w.deny(taskId);
  assert.notEqual((await del).code, 0);
  assert.equal(w.gh.ref(REPO, "refs/heads/main"), sha);
  // a yes lets it through
  const again = w.run(dir, "push", "origin", ":main");
  const second = await w.waitHeld(2);
  w.approve(second);
  assert.equal((await again).code, 0);
  assert.equal(w.gh.ref(REPO, "refs/heads/main"), null);
}));

test("the default branch is what GitHub calls it, not what the client says", T, () => withWorld({ branch: "trunk" }, async (w) => {
  const dir = await w.clone();
  await w.run(dir, "checkout", "-b", "main");
  await w.commit(dir, "a.txt");
  assert.equal((await w.run(dir, "push", "origin", "main")).code, 0, "a branch named main is a branch when trunk is the default");
  assert.equal(w.held().length, 0);
  const t = await w.run(dir, "checkout", "trunk");
  assert.equal(t.code, 0, t.out);
  await w.commit(dir, "t.txt");
  const push = w.run(dir, "push", "origin", "trunk");
  const taskId = await w.waitHeld();
  assert.equal(w.holds.get(taskId)!.action, "push_default");
  w.approve(taskId);
  assert.equal((await push).code, 0);
}));

test("a large pack is streamed through", T, () => withWorld({}, async (w) => {
  const dir = await w.clone();
  await w.run(dir, "checkout", "-b", "big");
  fs.writeFileSync(path.join(dir, "big.bin"), (await import("node:crypto")).randomBytes(12 * 1024 * 1024));
  await w.run(dir, "add", ".");
  assert.equal((await w.run(dir, "commit", "-m", "big")).code, 0);
  const r = await w.run(dir, "push", "origin", "big");
  assert.equal(r.code, 0, r.out);
  assert.ok(w.gh.ref(REPO, "refs/heads/big"));
  const back = await w.run(w.tmp, "clone", "--branch", "big", `https://github.com/${REPO}.git`, path.join(w.tmp, "again"));
  assert.equal(back.code, 0, back.out);
  assert.equal(fs.statSync(path.join(w.tmp, "again", "big.bin")).size, 12 * 1024 * 1024);
}));

test("a large push to the default branch waits with its pack unsent, then lands after the yes or is dropped after the no", T, () => withWorld({}, async (w) => {
  const dir = await w.clone();
  fs.writeFileSync(path.join(dir, "big.bin"), (await import("node:crypto")).randomBytes(10 * 1024 * 1024));
  await w.run(dir, "add", ".");
  assert.equal((await w.run(dir, "commit", "-m", "big")).code, 0);
  const sha = (await w.run(dir, "rev-parse", "HEAD")).out.trim();
  const before = w.gh.ref(REPO, "refs/heads/main");
  const no = w.run(dir, "push", "origin", "HEAD:main");
  w.deny(await w.waitHeld());
  const denied = await no;
  assert.notEqual(denied.code, 0);
  assert.match(denied.out, /not approved/);
  assert.equal(w.gh.ref(REPO, "refs/heads/main"), before);
  const yes = w.run(dir, "push", "origin", "HEAD:main");
  const second = await w.waitHeld(2);
  await new Promise((r) => setTimeout(r, 3_500));   // longer than the server's request timeout
  assert.equal(w.gh.ref(REPO, "refs/heads/main"), before, "the pack waits too");
  w.approve(second);
  const r = await yes;
  assert.equal(r.code, 0, r.out);
  assert.equal(w.gh.ref(REPO, "refs/heads/main"), sha);
  assert.equal(landed(w), 1);
}));

// ---- the door itself, with raw requests

async function raw(w: World, method: string, p: string, o: { auth?: string | null; headers?: Record<string, string>; body?: Buffer } = {}): Promise<{ status: number; text: string }> {
  return new Promise((done, fail) => {
    const headers: Record<string, string> = { ...(o.headers ?? {}) };
    const auth = o.auth === undefined ? `Basic ${Buffer.from(`vyre:${w.token}`).toString("base64")}` : o.auth;
    if (auth) headers["authorization"] = auth;
    const req = http.request(w.base + p, { method, headers, agent: false }, (res) => { const chunks: Buffer[] = []; res.on("data", (c) => chunks.push(c)); res.on("end", () => done({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("latin1") })); });
    req.on("error", fail);
    if (o.body) req.write(o.body);
    req.end();
  });
}
const pkt = (s: string): Buffer => Buffer.concat([Buffer.from((s.length + 4).toString(16).padStart(4, "0")), Buffer.from(s)]);
const A = "a".repeat(40), B = "b".repeat(40);
const PUSH = { "content-type": "application/x-git-receive-pack-request" };

test("a request with no token, a wrong token, an ended token or another repository is turned away", T, () => withWorld({ scope: [REPO] }, async (w) => {
  const adv = `/git/github/${REPO}.git/info/refs?service=git-upload-pack`;
  assert.equal((await raw(w, "GET", adv, { auth: null })).status, 401);
  assert.equal((await raw(w, "GET", adv, { auth: `Basic ${Buffer.from("vyre:vgp_nope").toString("base64")}` })).status, 401);
  assert.equal((await raw(w, "GET", adv, { auth: `Basic ${Buffer.from(`vyre:ghs_${"x".repeat(30)}`).toString("base64")}` })).status, 401, "a GitHub token is not a session");
  assert.equal((await raw(w, "GET", adv)).status, 200);
  assert.equal((await raw(w, "GET", `/git/github/${REPO}.git/info/refs?service=git-receive-pack`)).status, 200);
  const other = await raw(w, "GET", "/git/github/other-org/secret.git/info/refs?service=git-receive-pack");
  assert.equal(other.status, 403);
  assert.match(other.text, /only to the repositories of its chat/);
  assert.equal((await raw(w, "POST", "/git/github/other-org/secret.git/git-receive-pack", { headers: PUSH, body: Buffer.concat([pkt(`${A} ${B} refs/heads/x\0 report-status`), Buffer.from("0000")]) })).status, 403);
  assert.equal(w.gh.seen.some((s) => s.path.includes("other-org") && s.kind !== "none"), false, "no credential went to another repository");
  assert.equal((await raw(w, "GET", "/git/github/a/b/c.git/info/refs?service=git-upload-pack")).status, 404);
  w.proxy.port.revoke(w.token);
  assert.equal((await raw(w, "GET", adv)).status, 401, "revoked");
  assert.equal(w.proxy.live(), 0);
}));

test("a push that cannot be read exactly is refused before GitHub hears of it", T, () => withWorld({}, async (w) => {
  const url = `/git/github/${REPO}.git/git-receive-pack`;
  const refs = (): number => w.gh.seen.filter((s) => s.path.endsWith("/git-receive-pack")).length;
  const cases: Array<[string, Buffer, Record<string, string>, number]> = [
    ["not pkt-lines", Buffer.from("hello world, not a push"), PUSH, 400],
    ["a bad length", Buffer.from("zz00whatever"), PUSH, 400],
    ["a flush with a body behind it", Buffer.from("0000junk"), PUSH, 400],
    ["a bad ref", Buffer.concat([pkt(`${A} ${B} refs/heads/../main\0 report-status`), Buffer.from("0000")]), PUSH, 400],
    ["a bad object name", Buffer.concat([pkt(`${A} xyz refs/heads/x\0 report-status`), Buffer.from("0000")]), PUSH, 400],
    ["a push certificate", Buffer.concat([pkt("push-cert\0 push-cert=1"), Buffer.from("0000")]), PUSH, 400],
    ["a compressed body", Buffer.from("anything"), { ...PUSH, "content-encoding": "gzip" }, 415],
    ["the wrong kind of body", Buffer.from("anything"), { "content-type": "text/plain" }, 415],
    ["a list that never ends", Buffer.concat(Array.from({ length: 2000 }, (_, i) => pkt(i === 0 ? `${A} ${B} refs/heads/f0\0 report-status` : `${A} ${B} refs/heads/f${i}`))), PUSH, 413],
    ["a body that ends in the list", pkt(`${A} ${B} refs/heads/x\0 report-status`), PUSH, 400],
  ];
  for (const [name, body, headers, status] of cases) {
    const r = await raw(w, "POST", url, { headers, body }).catch((e) => ({ status: -1, text: `${name}: ${String(e)}` }));
    assert.equal(r.status, status, `${name}: ${r.text}`);
  }
  const probe = await raw(w, "POST", url, { headers: PUSH, body: Buffer.from("0000") });
  assert.deepEqual([probe.status, probe.text], [200, ""], "the lone flush git sends ahead of a large push is answered here");
  assert.equal(refs(), 0, "none reached GitHub");
  assert.equal(landed(w), 0);
  assert.equal(w.held().length, 0);
}));
