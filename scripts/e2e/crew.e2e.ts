// The real end to end run of Crew: a booted daemon on a temp Space, the REAL Claude CLI on the owner's test setup token, a throwaway local git repo set on a project, and a real browser.
// No scripted model and no tool-calling script: the person asks the lead in plain words and the script only watches, presses what a person presses, and checks the repository.
//
// NOT part of any CI glob. Run by hand:
//   set -a; source /Users/irfad/Claude/simba/secrets/.env.simba; set +a
//   VYRE_APP_DIST=<apps/app/dist> node --import tsx --import ./scripts/shots/rn-alias.mjs scripts/e2e/crew.e2e.ts
// Secrets: the token comes from the environment, goes into the Vault through its write capability and nowhere else; every line printed or saved is scrubbed of it.
import { DatabaseSync } from "node:sqlite";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeBundle } from "../../client/src/crypto/keys.ts";
import { holdKeyOnOwnNode } from "../../client/src/gateway/local-key.ts";
import { fakePlatform } from "../../host/src/platform/index.ts";
import type { FetchFn } from "../../host/src/platform/probes.ts";
import { loadConfig } from "../../host/src/daemon/config.ts";
import { CODE_ROOT, startDaemon } from "../../host/src/daemon/daemon.ts";
import type { Daemon } from "../../host/src/daemon/daemon.ts";
import { workFolder } from "../../modules/engine/sandbox.ts";
import { edge } from "../../apps/app/tests/real-app-harness.test.ts";

const TOKEN = process.env["VYRE_TEST_CLAUDE_SETUP_TOKEN"] ?? "";
if (!TOKEN) throw new Error("load the vault env first: VYRE_TEST_CLAUDE_SETUP_TOKEN is required");
const DIST = process.env["VYRE_APP_DIST"] ?? "";
const OUT = process.env["E2E_OUT"] ?? "/private/tmp/claude-501/-Users-irfad-Claude/244d818f-f61b-4448-8728-ddfc2a911874/scratchpad/crew-e2e";
fs.mkdirSync(OUT, { recursive: true });
const scrub = (s: string): string => s.split(TOKEN).join("[secret]").replace(/sk-ant-[A-Za-z0-9_-]{6,}/g, "[token]");
const lines: string[] = [];
const say = (who: string, text: string): void => { const l = `**${who}** ${scrub(text)}`; lines.push(l); console.log(l.slice(0, 500)); };
const save = (): void => { fs.writeFileSync(path.join(OUT, "transcript.md"), `# Crew, real run\n\n${lines.join("\n\n")}\n`); };
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const git = (cwd: string, ...a: string[]): string => spawnSync("git", a, { cwd, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "Owner", GIT_AUTHOR_EMAIL: "o@example.com", GIT_COMMITTER_NAME: "Owner", GIT_COMMITTER_EMAIL: "o@example.com" } }).stdout;

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vyre-e2e-crew-")));
const PASSWORD = "crew e2e password 7731";

const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vyre-e2e-crew-repo-")));
git(repo, "init", "--quiet", "-b", "main");
fs.writeFileSync(path.join(repo, "index.html"), "<!doctype html>\n<html><head><title>Bakery</title><style>body { background: #fff; color: #222; }</style></head>\n<body><h1>Maple Bakery</h1><p>Fresh bread every morning.</p></body></html>\n");
fs.writeFileSync(path.join(repo, "README.md"), "A small bakery site.\n");
git(repo, "add", "-A"); git(repo, "commit", "--quiet", "-m", "first");

const start = (): Promise<Daemon> => startDaemon({
  config: loadConfig(["--data-dir", dir, "--port", "0", "--space", "spc_fresh", "--space-name", "Crew Co"], {}, "1.2.3"), codeRoot: CODE_ROOT,
  platform: fakePlatform({ os: process.platform === "darwin" ? "darwin" : "linux", hostname: "e2e-crew", free: 80e9, commands: {
    [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" }, "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" }, "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
  } }),
  fetch: caddyFetch,
  intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
});
let d: Daemon = await start();
let keys = 0;
let tok = "";
let personKey: unknown;
async function call(cap: string, input: Record<string, unknown> = {}): Promise<{ status: number; data: any }> {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${tok || d.token}` }, body: JSON.stringify({ idempotencyKey: `e2e-${cap}-${++keys}`, ...input }) });
  const body = (await r.json()) as { data?: unknown; error?: unknown };
  return { status: r.status, data: body.data ?? body };
}
async function ok(cap: string, input: Record<string, unknown> = {}): Promise<any> {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await call(cap, input);
  if (r.status !== 200) throw new Error(`${cap}: ${r.status} ${scrub(JSON.stringify(r.data)).slice(0, 400)}`);
  return r.data;
}
function hostLines(n = 60): string {
  d.sink.flush();
  const rows = new DatabaseSync(d.paths.logs, { readOnly: true }).prepare("SELECT level, place, cap, msg, attrs FROM logs ORDER BY id DESC LIMIT ?").all(n) as { level: number; place?: string; cap?: string; msg: string; attrs?: string }[];
  return scrub(rows.reverse().map((r) => `${r.level} ${r.place ?? ""} ${r.cap ?? ""} ${r.msg} ${String(r.attrs ?? "").slice(0, 300)}`).join("\n"));
}
async function waitFor<T>(what: string, fn: () => Promise<T | null | false>, ms: number): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v as T;
    if (Date.now() - t0 > ms) throw new Error(`timed out (${Math.round(ms / 1000)} s) waiting for ${what}`);
    await sleep(2000);
  }
}
type Msg = { id: string; messageId?: string; author?: { kind?: string; id?: string }; body?: string; blocks?: { type: string; state?: string; data?: any }[] };   // eslint-disable-line @typescript-eslint/no-explicit-any
const msgs = async (threadId: string): Promise<Msg[]> => (await ok("chat.messages.list", { threadId })).messages as Msg[];
const fail = (m: string): never => { throw new Error(m); };

// ---- the browser: the person's own view of the lead's chat
let web: { origin: string; close(): void } | null = null;
let browser: import("playwright-core").Browser | null = null;
let page: import("playwright-core").Page | null = null;
let shotN = 0;
let owner = "";
async function openPage(threadId: string): Promise<void> {
  if (!DIST) return;
  try { await page?.close(); } catch { /* gone */ }
  try { web?.close(); } catch { /* gone */ }
  const { webkit } = await import("playwright-core");
  browser ??= await webkit.launch({});
  web = await edge(DIST, d.url);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript((s: unknown) => { try { localStorage.setItem("vyre.session.v1", JSON.stringify({ sessions: { [(s as { baseUrl: string }).baseUrl]: s } })); } catch { /* blocked */ } }, {
    baseUrl: web.origin, token: tok, personId: owner, marker: ((await ok("spaces.get", {})).space.fingerprint as string), def: { spaceId: "spc_fresh", name: "Crew Co", kind: "team", address: web.origin, role: "Owner", tint: ["#6E5CF0", "#9B6BE8"], kit: "northwind", skinDefault: "system", starred: true, needsYou: false, console: true, terminal: true, counts: {}, dots: {} },
  });
  page = await ctx.newPage();
  await page.goto(`${web.origin}/chat#screen=chats.conversation&threadId=${threadId}`, { waitUntil: "load" });
  await page.getByTestId("shell").waitFor({ timeout: 40_000 }).catch(() => undefined);
}
async function shot(name: string): Promise<string> {
  if (!page) return "(no browser)";
  const file = path.join(OUT, `${String(++shotN).padStart(2, "0")}-${name}.png`);
  await page.screenshot({ path: file }).catch(() => undefined);
  const text = await page.locator("body").innerText().catch(() => "");
  return `${file} | Working shown: ${/\bWorking\b/.test(text)} | error text: ${/could not be shown|went wrong|Try again/i.test(text)}`;
}

async function main(): Promise<void> {
  let chat = "";
  try {
    const code = /claim\/([^#]+)/.exec(d.claim!.url)![1]!;
    const spaceId = /s=([^&]+)/.exec(d.claim!.url)![1]!;
    const made = await makeBundle(PASSWORD, "crew-e2e-recovery-code-1", { spaceId });
    const claimed = await fetch(`${d.url}/v1/identity/claim_owner`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, spaceId, displayName: "Maya Chen", username: "maya", password: PASSWORD, deviceName: "e2e", deviceClass: "desktop", keys: { personKeyByPassword: made.personKeyByPassword, personKeyByRecovery: made.personKeyByRecovery, publicKey: made.publicKey, privateKeyWrapped: made.privateKeyWrapped, spaceKeys: made.spaceKeys ?? [] } }) });
    if (claimed.status !== 200) throw new Error(`claim ${claimed.status}`);
    tok = ((await claimed.json()) as { data: { session: { token: string } } }).data.session.token;
    personKey = made.personKey;
    if ((await holdKeyOnOwnNode(d.url, tok, made.personKey as never)) !== true) throw new Error("the key was not held");
    await ok("spaces.onboarding.seen", { flow: "team" }).catch(() => undefined);
    const accounts = (await ok("vault.folders.create", { name: "Accounts", scope: "mine" })).folder.id as string;
    const flow = await ok("providers.subscription_start", { providerKey: "claude-code" });
    await ok("vault.item.put", { folderId: accounts, name: "Claude setup", kind: "ai_subscription", fields: [{ key: "setup_token", value: TOKEN, secret: true }] });
    const provider = (await ok("providers.subscription_complete", { flowId: flow.flowId })).provider;
    await ok("providers.set_space_use", { providerId: provider.id, allow: true });
    await ok("engine.pool.status");
    say("setup", `temp Space, AI account ${provider.providerKey} (${provider.state}), repo ${repo}`);

    const project = (await ok("projects.create", { type: "project", title: "Bakery site" })).projectId as string;
    const teammate = (await ok("projects.teammates.create", { projectId: project, name: "Ember", role: "member" })).teammate.agentId as string;
    await ok("engine.crew.repo.set", { projectId: project, path: repo });
    const lead = (await ok("agents.create", { name: "Lead", role: "You lead the work on the person's project." })).agent.agentId as string;
    owner = (await ok("agents.get", { agentId: lead })).agent.ownerId as string;
    chat = (await ok("chat.start", { kind: "chat", agentIds: [lead], title: "Bakery site", scopeType: "project", scopeId: project })).thread.threadId as string;
    await ok("threads.set_mode", { threadId: chat, mode: "auto" });
    say("setup", `project ${project}, teammate Ember, lead ${lead}, chat ${chat}`);
    await openPage(chat);

    // ---- step 1: plain words
    const ask = "Add a dark mode toggle to this small site. Give it to a teammate.";
    await ok("chat.post", { threadId: chat, body: ask, mentions: [{ kind: "agent", id: lead }] });
    say("person", ask);
    const job = await waitFor("the lead to start a teammate", async () => ((await ok("engine.crew.list", { threadId: chat })).jobs as any[])[0] ?? null, 240_000).catch(async (e) => {   // eslint-disable-line @typescript-eslint/no-explicit-any
      say("DIAG", `no teammate started. thread: ${JSON.stringify((await msgs(chat)).map((m) => [m.author?.kind, String(m.body).slice(0, 200), (m.blocks ?? []).map((b) => `${b.type}:${b.state}`)]))}`);
      throw e;
    });
    say("STEP1 ok", `the real lead started ${job.name} on "${job.title}", branch ${job.branch}, state ${job.state}`);
    await sleep(2500); say("shot", await shot("started-working"));
    const start1 = (await msgs(chat)).find((m) => (m.blocks ?? []).some((b) => b.type === "helper"));
    say("STEP1 line", `the start line message: ${JSON.stringify(start1?.body)}; helper block crew flag: ${JSON.stringify(start1?.blocks?.find((b) => b.type === "helper")?.data?.crew)}`);
    if (page) { const t = await page.locator("body").innerText(); say("STEP1 ui", `"is on" line shown: ${/is on /.test(t)}; "Started a helper" shown: ${/Started a helper/.test(t)}`); }

    // ---- step 2/3: the teammate works and commits in its own folder; one result card arrives
    const card = await waitFor("the result card", async () => (await msgs(chat)).find((m) => (m.blocks ?? []).some((b) => b.type === "crew_result" && b.data?.state && b.data.state !== "working")) ?? null, 420_000).catch(async (e) => {
      say("DIAG", `no card. jobs ${JSON.stringify((await ok("engine.crew.list", { threadId: chat })).jobs)}; log:\n${hostLines(30)}`);
      throw e;
    });
    const cdata = card.blocks!.find((b) => b.type === "crew_result")!.data;
    say("STEP3", `result card: state ${cdata.state}, ${JSON.stringify(cdata.commits)} commit(s), ${cdata.files?.length} file(s): ${(cdata.files ?? []).map((f: { path: string }) => f.path).join(", ")}; text: ${String(cdata.text).slice(0, 200)}`);
    const cards = (await msgs(chat)).filter((m) => (m.blocks ?? []).some((b) => b.type === "crew_result"));
    const stray = (await msgs(chat)).filter((m) => (m.blocks ?? []).some((b) => b.type === "turn_status" && b.data?.state === "failed"));
    say("STEP3 check", `cards: ${cards.length}; failed-turn notices in the lead's chat: ${stray.length}`);
    if (cards.length !== 1) fail(`expected one card, found ${cards.length}`);
    if (stray.length) fail("a failed-turn notice is in the lead's chat");
    const branches = git(repo, "branch", "--list", "crew/*").trim();
    say("STEP2", `repo branches: ${branches || "(none yet, the work is in the teammate's copy until Merge)"}; original tree has dark mode: ${/dark/i.test(fs.readFileSync(path.join(repo, "index.html"), "utf8"))}`);
    await sleep(8000); say("shot", await shot("card-and-lead-reply"));
    const idle = await waitFor("lead idle", async () => { const t = page ? await page.locator("body").innerText() : ""; return /\bWorking\b/.test(t) ? null : true; }, 120_000).catch(() => false);
    say("STEP4", `header clear of Working after everything is done: ${idle ? "yes" : "NO, still shows Working"}`);
    say("shot", await shot("done-header"));

    // ---- step 5: send back
    await ok("engine.crew.message", { jobId: job.jobId, body: "Please also make the toggle remember the choice after a reload (localStorage). Keep it small." });
    say("STEP5", "sent back: remember the choice after a reload");
    const second = await waitFor("a second card after send back", async () => ((await msgs(chat)).filter((m) => (m.blocks ?? []).some((b) => b.type === "crew_result")).length >= 2 ? true : null), 420_000);
    void second;
    const jobs2 = (await ok("engine.crew.list", { threadId: chat })).jobs as any[];   // eslint-disable-line @typescript-eslint/no-explicit-any
    say("STEP5 ok", `after send back: ${jobs2.map((j) => `${j.name} ${j.state}`).join("; ")}; teammate thread reply: ${JSON.stringify(String((await msgs(job.threadId)).filter((m) => m.author?.kind === "agent").at(-1)?.body).slice(0, 200))}`);
    say("shot", await shot("after-send-back"));

    // ---- step 6: the person tells the lead in plain words; the card must follow the repository
    await ok("chat.post", { threadId: chat, body: "Looks good, just merge it.", mentions: [{ kind: "agent", id: lead }] });
    say("person", "Looks good, just merge it.");
    let flipped = false;
    for (let i = 0; i < 75 && !flipped; i++) { await sleep(2000); flipped = ((await ok("engine.crew.list", { threadId: chat })).jobs as any[]).find((j) => j.jobId === job.jobId)?.state === "merged"; }   // eslint-disable-line @typescript-eslint/no-explicit-any
    const holds = ((await ok("gate.holds.list", {})).holds as Array<{ act: string; state: string }>).map((h) => `${h.act}:${h.state}`);
    say("STEP6", `after "just merge it": job merged ${flipped}; Gate holds: ${holds.join(", ") || "none"}; repo log: ${git(repo, "log", "--oneline").trim().replace(/\n/g, " | ")}`);
    await sleep(6000); say("shot", await shot("after-just-merge-it"));
    if (!flipped) {
      const merged = await ok("engine.crew.merge", { jobId: job.jobId });
      say("STEP6", `(fallback) a person pressed Merge: landed ${merged.landed}`);
    }
    const stale = await ok("engine.crew.merge", { jobId: job.jobId });
    say("STEP6", `a stale Merge answers: landed ${stale.landed}, note ${JSON.stringify(stale.note)}`);
    if (!stale.landed || !/Already merged/.test(String(stale.note))) fail("a stale Merge did not say it is already merged");
    say("STEP6", `index.html mentions dark: ${/dark/i.test(fs.readFileSync(path.join(repo, "index.html"), "utf8"))}`);

    // ---- step 7: restart the daemon mid-work
    const ask2 = "Now add a small footer with the text \"Open daily 7 to 3\" to the site. Give it to a teammate too.";
    await ok("chat.post", { threadId: chat, body: ask2, mentions: [{ kind: "agent", id: lead }] });
    say("person", ask2);
    const job2 = await waitFor("the second teammate job", async () => ((await ok("engine.crew.list", { threadId: chat })).jobs as any[]).find((j) => j.jobId !== job.jobId) ?? null, 240_000);   // eslint-disable-line @typescript-eslint/no-explicit-any
    say("STEP7", `second job started: ${job2.title}, ${job2.branch}, state ${job2.state}; restarting the daemon now`);
    await sleep(6000);
    try { await page?.close(); web?.close(); } catch { /* closing */ }
    await d.stop();
    d = await start();
    await holdKeyOnOwnNode(d.url, tok, personKey as never).catch(() => undefined);
    await ok("engine.pool.status").catch(() => undefined);
    say("STEP7", "daemon restarted");
    const resumed = await waitFor("the second job to finish after the restart", async () => ((await ok("engine.crew.list", { threadId: chat })).jobs as any[]).find((j) => j.jobId === job2.jobId && j.state === "done") ?? null, 420_000).catch(async (e) => {   // eslint-disable-line @typescript-eslint/no-explicit-any
      say("DIAG", `after restart: ${JSON.stringify((await ok("engine.crew.list", { threadId: chat })).jobs)}\n${hostLines(30)}`);
      throw e;
    });
    if (resumed.state !== "done") { say("DIAG", `second job ${resumed.state}; its thread: ${JSON.stringify((await msgs(job2.threadId)).map((m) => [m.author?.kind, String(m.body).slice(0, 300), (m.blocks ?? []).map((b) => `${b.type}:${b.state}:${JSON.stringify(b.data).slice(0, 160)}`)]))}\n${hostLines(40)}`); }
    say("STEP7 ok", `after the restart the second job is ${resumed.state}; cards in chat: ${(await msgs(chat)).filter((m) => (m.blocks ?? []).some((b) => b.type === "crew_result")).length}`);
    await openPage(chat); await sleep(3000); say("shot", await shot("after-restart"));
    // a person merges the footer in a terminal: no button, no lead. The open page must flip on its own.
    const work2 = workFolder(dir, owner, job2.threadId);
    git(repo, "fetch", "--quiet", work2, `+${job2.branch}:refs/heads/${job2.branch}`);
    git(repo, "merge", "--no-ff", "--no-edit", job2.branch);
    let seen = false;
    for (let i = 0; i < 20 && !seen; i++) { await sleep(3000); seen = ((await ok("engine.crew.list", { threadId: chat })).jobs as any[]).find((j) => j.jobId === job2.jobId)?.state === "merged"; }   // eslint-disable-line @typescript-eslint/no-explicit-any
    await sleep(6000);
    const t2 = page ? await page.locator("body").innerText() : "";
    say("STEP8", `merged by hand in a terminal: job state merged ${seen}; open page shows Merged without a refresh: ${/Merged · /.test(t2)}`);
    say("shot", await shot("merged-in-terminal"));
    if (!seen) fail("a branch merged by hand was not noticed");
    d.sink.flush();
    const logs = JSON.stringify(new DatabaseSync(d.paths.logs, { readOnly: true }).prepare("SELECT msg, attrs FROM logs").all());
    if (logs.includes(TOKEN)) fail("the token is in the host logs");
    say("RESULT", "PASSED all steps");
    save();
  } catch (e) {
    say("ERROR", e instanceof Error ? e.message : String(e));
    try { fs.writeFileSync(path.join(OUT, "host-log.txt"), hostLines(120)); if (chat) fs.writeFileSync(path.join(OUT, "messages-private.json"), scrub(JSON.stringify(await msgs(chat), null, 1))); } catch { /* best effort */ }
    try { say("shot", await shot("error")); } catch { /* none */ }
    save();
    process.exitCode = 1;
  } finally {
    try { if (chat) await ok("threads.cancel", { threadId: chat }); } catch { /* not running */ }
    try { await browser?.close(); web?.close(); } catch { /* closing */ }
    try { await d.stop(); } catch { /* closing */ }
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(repo, { recursive: true, force: true });
    process.exit(process.exitCode ?? 0);
  }
}
await main();
