// The Gate on a booted daemon, with a connected GitHub, and a real `git push origin HEAD:main` from a session environment (lane l-hooks-gitproxy).
// Real: the daemon, the github module (connect with PKCE, the policy, the token broker), the Gate (the hold, the task, the approval), the event log, the chat, git on both ends, the proxy, githubEnv.
// Stand-ins: GitHub's API and OAuth (one scripted fetch) and GitHub's git server (real bare repositories behind git http-backend).
// Run 1: the push to main is held, nothing lands, the card is in the chat, the person approves, the push lands. Run 2: the next push to main asks again (the approval was for one push), the person says no,
// git is told, and nothing was written. A branch push in between lands with no question.
// @reads /host/src/seams/git-proxy.ts
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fakePlatform } from "../host/src/platform/index.ts";
import type { FetchFn } from "../host/src/platform/probes.ts";
import { loadConfig } from "../host/src/daemon/config.ts";
import { CODE_ROOT, startDaemon } from "../host/src/daemon/daemon.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";
import { githubEnv } from "../modules/engine/github-session.ts";
import { fakeGithubGit } from "../host/tests/helpers/fake-github-git.ts";

const KEYS = { personKeyByPassword: "cGVyc29uLWJ5LXBhc3N3b3Jk", publicKey: "cHVibGljLWtleQ==", privateKeyWrapped: "cHJpdmF0ZS13cmFwcGVk", spaceKeys: [{ epoch: 1, wrapped: "c3BhY2Uta2V5LTE=" }] };
const PASSWORD = "correct horse battery staple 9";
const REPO = "vyre-ai/website";
type J = any;   // eslint-disable-line @typescript-eslint/no-explicit-any

async function call(d: Daemon, token: string | null, cap: string, input: unknown): Promise<{ status: number; data: J; body: J }> {
  const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(input) });
  const body = (await r.json()) as J;
  return { status: r.status, data: body.data ?? body, body };
}
async function waitFor<T>(d: Daemon, f: () => Promise<T | null>, ms = 30_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) { await d.hooks?.pump?.(); const v = await f(); if (v !== null) return v; if (Date.now() > end) throw new Error("waitFor: it never happened"); await new Promise<void>((r) => setTimeout(r, 150)); }
}
const answer = (status: number, body: unknown) => ({ status, ok: status < 300, headers: { get: () => null }, text: async () => JSON.stringify(body), json: async () => body, arrayBuffer: async () => new ArrayBuffer(0) });

test("a real git push to main on a booted daemon: held, approved, landed; then asked again, denied, nothing written", { timeout: 180_000 }, async () => {
  const gh = await fakeGithubGit([REPO]);
  let minted = 0;
  const api: any = async (url: string, init?: { method?: string; body?: string }) => {   // eslint-disable-line @typescript-eslint/no-explicit-any
    const u = new URL(url), method = init?.method ?? "GET", p = u.pathname;
    if (u.host === "github.com" && p === "/login/oauth/access_token") return answer(200, { access_token: "ghu_live_1", refresh_token: "ghr_live_1", expires_in: 28800 });
    if (u.host !== "api.github.com") return answer(200, { apps: { http: {} } });
    if (p === "/user") return answer(200, { id: 4242, login: "dana-codes" });
    if (p === "/user/installations") return answer(200, { installations: [{ id: 9001, account: { login: "vyre-ai" }, repository_selection: "all" }] });
    if (p === "/user/installations/9001/repositories") return answer(200, { repositories: [{ full_name: REPO }] });
    if (p === "/user/orgs") return answer(200, [{ login: "vyre-ai", id: 9 }]);
    if (p === `/repos/${REPO}/installation`) return answer(200, { id: 9001, account: { login: "vyre-ai" } });
    if (p === "/app/installations") return answer(200, [{ id: 9001, account: { login: "vyre-ai" }, repository_selection: "all" }]);
    if (p === "/app") return answer(200, { id: 1, slug: "vyre-live", name: "Vyre", permissions: {}, events: [] });
    if (method === "POST" && p === "/app/installations/9001/access_tokens") {
      const perms = (JSON.parse(init?.body ?? "{}") as { permissions?: Record<string, string> }).permissions ?? {};
      const token = `ghs_live_${++minted}`;
      gh.tokens.set(token, perms["contents"] === "write" ? "write" : "read");
      return answer(201, { token, expires_at: new Date(Date.now() + 3_600_000).toISOString(), permissions: perms });
    }
    if (p === `/repos/${REPO}`) return answer(200, { full_name: REPO, default_branch: "main", private: true });
    return answer(404, { message: `unscripted ${method} ${p}` });
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-gitgate-"));
  const d = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0", "--space", "spc_gitgate", "--space-name", "Space", "--space-kind", "team", "--address", "team.example.com"], {}, "1.2.3"),
    codeRoot: CODE_ROOT,
    platform: fakePlatform({ os: "linux", hostname: "gitgate", free: 80e9, commands: { [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" }, "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\n" } } }),
    fetch: (async () => answer(200, { apps: { http: {} } })) as unknown as FetchFn,
    http: api, seams: { fetch: api },
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
    vault: { secret: async (h: string) => (h.includes("Id") ? "424242" : "fixture-secret"), signRs256: async () => "sig" },
    gitUpstream: gh.url,
  } as never);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-gitgate-work-"));
  const saved = { id: process.env["VYRE_GH_OAUTH_CLIENT_ID"], secret: process.env["VYRE_GH_OAUTH_CLIENT_SECRET"] };
  process.env["VYRE_GH_OAUTH_CLIENT_ID"] = "Iv1.live"; process.env["VYRE_GH_OAUTH_CLIENT_SECRET"] = "live-secret";
  try {
    // ---- the person: claimed, signed in, key unlocked; the assistant; a chat with it
    const code = decodeURIComponent(new URL(d.claim!.url).pathname.split("/").pop() ?? "");
    const device = { deviceName: "Mac", deviceClass: "desktop" };
    assert.equal((await call(d, null, "identity.claim_owner", { code, spaceId: "spc_gitgate", username: "dana", displayName: "Dana Reyes", password: PASSWORD, ...device, keys: KEYS })).status, 200);
    const token = (await call(d, null, "identity.sign_in", { username: "dana", password: PASSWORD, ...device })).data.session.token as string;
    const me = (await call(d, token, "identity.whoami", {})).data.principal.id as string;
    await fetch(`${d.url}/local/vault/key/unlock`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ key: Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(32))).toString("base64") }) });
    const assistant = await waitFor(d, async () => {
      const l = (await call(d, token, "agents.list", { section: "personal", limit: 100 })).data.agents as Array<{ agentId: string; ownerId: string; role?: string }>;
      return l.find((a) => a.ownerId === me && a.role === "assistant") ?? null;
    });
    const threadId = (await call(d, token, "chat.start", { kind: "chat", agentIds: [assistant.agentId], title: "Ship it", idempotencyKey: "g-chat" })).data.thread.threadId as string;

    // ---- GitHub connected: the App row, then connect (PKCE) and complete; the policy
    assert.equal((await call(d, token, "github.me.status", {})).status, 200);   // makes the module's tables
    d.db!.run(`INSERT OR IGNORE INTO github_app ("id", "appId", "slug", "name", "permissions", "events", "createdAt") VALUES (?, ?, ?, ?, ?, ?, ?)`, "app", 424242, "vyre-live", "Vyre", "{}", "[]", 0);
    const connect = await call(d, token, "github.me.connect", {});
    assert.equal(connect.status, 200, JSON.stringify(connect.body));
    const done = await call(d, token, "github.me.complete", { code: "code-live", state: connect.data.state });
    assert.equal(done.status, 200, JSON.stringify(done.body));
    assert.equal((await call(d, token, "github.me.status", {})).data.connected, true);
    assert.equal((await call(d, token, "github.me.policy.set", { policy: { read: "always", push_branch: "always", push_default: "ask" } })).status, 200);

    // ---- the session's environment, from the engine's own function, on the daemon's own git port
    const asMe = async (cap: string, input: unknown): Promise<unknown> => {
      if (cap === "threads.get") return { thread: { scopeType: "project", scopeId: "prj_site" } };
      if (cap === "projects.get") return { project: { folderId: "fld_site" } };
      if (cap === "git.status") return { remotes: [{ url: `https://github.com/${REPO}.git` }] };
      const r = await call(d, token, cap, input);
      if (r.status !== 200) throw new Error(`${cap}: ${JSON.stringify(r.body)}`);
      return r.data;
    };
    const session = await githubEnv({ call: asMe, git: d.gitPort }, me, threadId, assistant.agentId);
    assert.ok(session.env["VYRE_GIT_TOKEN"], JSON.stringify(Object.keys(session.env)));
    assert.equal(Object.values(session.env).some((v) => /gh[pousr]_/.test(v)), false, "no GitHub token in the session");
    // the Space's public address is a name this test machine cannot reach: git is sent to the daemon's own loopback address instead, the one route the engine's wall carries elsewhere
    const here = Object.fromEntries(Object.entries(session.env).map(([k, v]) => [k.replace("https://team.example.com", d.url), v.replace("https://team.example.com", d.url)]));
    const env = { PATH: process.env["PATH"] ?? "", HOME: tmp, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", GIT_TERMINAL_PROMPT: "0", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t", ...here };
    const git = (cwd: string, ...args: string[]) => new Promise<{ code: number; out: string }>((done2) => {
      const p = spawn("git", args, { cwd, env }); let out = "";
      p.stdout.on("data", (c) => { out += String(c); }); p.stderr.on("data", (c) => { out += String(c); });
      p.on("close", (c) => done2({ code: c ?? -1, out }));
    });
    const work = path.join(tmp, "work");
    const cloned = await git(tmp, "clone", `https://github.com/${REPO}.git`, work);
    assert.equal(cloned.code, 0, cloned.out);
    const commit = async (file: string): Promise<string> => { fs.writeFileSync(path.join(work, file), `${file} ${Math.random()}`); await git(work, "add", "."); assert.equal((await git(work, "commit", "-m", file)).code, 0); return (await git(work, "rev-parse", "HEAD")).out.trim(); };
    const holds = async (state: string): Promise<J[]> => ((await call(d, token, "gate.holds.list", { states: [state] })).data.holds ?? []) as J[];
    const landed = (): number => gh.writes().filter((s) => s.method === "POST").length;
    const messages = async (): Promise<J[]> => (await call(d, token, "chat.messages.list", { threadId })).data.messages ?? [];

    // ---- a branch push: no question
    await git(work, "checkout", "-b", "feature");
    const featureSha = await commit("a.txt");
    const b = await git(work, "push", "origin", "feature");
    assert.equal(b.code, 0, b.out);
    assert.equal(gh.ref(REPO, "refs/heads/feature"), featureSha);
    assert.equal((await holds("held")).length, 0, "a branch push asked nothing");

    // ---- run 1: HEAD:main is held, nothing lands, the card is in the chat, the yes lets it land
    const mainBefore = gh.ref(REPO, "refs/heads/main");
    const push1 = git(work, "push", "origin", "HEAD:main");
    let early: { code: number; out: string } | null = null;
    void push1.then((r) => { early = r; });
    const hold1 = await waitFor(d, async () => { if (early) throw new Error(`the push ended before it was held: ${JSON.stringify(early)}`); return (await holds("held"))[0] ?? null; }, 20_000);
    assert.equal(hold1.capName, "github.me.approve");
    assert.equal(hold1.act, "github_approval", "its own act, not post");
    assert.deepEqual([hold1.principal, hold1.actingFor], [{ kind: "agent", id: assistant.agentId }, me], "asked by the session's agent, for the person");
    await new Promise((r) => setTimeout(r, 600));
    assert.equal(gh.ref(REPO, "refs/heads/main"), mainBefore, "not landed while it waits");
    assert.equal(landed(), 1, "only the branch push has reached GitHub with a write token");
    const card = await waitFor(d, async () => (await messages()).flatMap((m) => (m.blocks ?? []) as J[]).find((blk) => blk.type === "link_card" && blk.data?.target?.id === hold1.taskId) ?? null);
    assert.deepEqual([card.data.lead, card.data.title], ["Approval", "Push to main on vyre-ai/website"]);
    const after1 = (await d.log!.read({ type: "gate.*", limit: 500 })).length;
    assert.equal((await call(d, token, "tasks.act", { taskId: hold1.taskId, action: "approve" })).status, 200);
    const r1 = await push1;
    assert.equal(r1.code, 0, r1.out);
    assert.match(r1.out, /Waiting for Dana to approve the push to main/, "git was told why it waited");
    assert.equal(gh.ref(REPO, "refs/heads/main"), featureSha, "landed after the yes");
    const approved = (await d.log!.read({ type: "gate.approved", limit: 50 })).map((e) => JSON.parse(new TextDecoder().decode(e.payload)) as J).find((p) => p.taskId === hold1.taskId);
    assert.ok(approved, "the Gate's approval is on the log, and it is what woke the push");
    assert.ok((await d.log!.read({ type: "gate.*", limit: 500 })).length > after1);
    assert.equal(landed(), 2);

    // ---- the Space lets agents post, and the person has an Always allow for posting for this agent: a push to main is still held, because GitHub approval is its own act that only the person lifts
    assert.equal((await call(d, token, "gate.rules.set", { act: "post", scope: "space", mode: "allow", agentOkFor: "high" })).status, 200);
    assert.equal((await call(d, token, "gate.allow.set", { act: "post", target: "*", agentId: assistant.agentId, days: 30 })).status < 500, true);
    const refusedRule = await call(d, token, "gate.rules.set", { act: "github_approval", scope: "space", mode: "allow" });
    assert.notEqual(refusedRule.status, 200, "no rule can let a GitHub approval through");

    // ---- run 2: the next push to main asks again, the person says no, nothing is written
    const secondSha = await commit("b.txt");
    const push2 = git(work, "push", "origin", "HEAD:main");
    const hold2 = await waitFor(d, async () => (await holds("held")).find((h) => h.taskId !== hold1.taskId) ?? null);
    assert.notEqual(hold2.taskId, hold1.taskId, "the first yes did not cover this push");
    assert.equal((await call(d, token, "tasks.act", { taskId: hold2.taskId, action: "reject", note: "Not this one" })).status, 200);
    const r2 = await push2;
    assert.notEqual(r2.code, 0);
    assert.match(r2.out, /rejected/);
    assert.match(r2.out, /was not approved/);
    assert.equal(gh.ref(REPO, "refs/heads/main"), featureSha, "main is where the first push left it");
    assert.notEqual(gh.ref(REPO, "refs/heads/main"), secondSha);
    assert.equal(landed(), 2, "nothing was written");
    session.end();
  } finally {
    process.env["VYRE_GH_OAUTH_CLIENT_ID"] = saved.id as string; process.env["VYRE_GH_OAUTH_CLIENT_SECRET"] = saved.secret as string;
    if (saved.id === undefined) delete process.env["VYRE_GH_OAUTH_CLIENT_ID"]; if (saved.secret === undefined) delete process.env["VYRE_GH_OAUTH_CLIENT_SECRET"];
    await d.stop(); await gh.close(); fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(tmp, { recursive: true, force: true });
  }
});
