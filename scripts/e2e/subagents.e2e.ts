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

    // ---- the owner's ask in a plain chat: "launch a subagent or two"
    const plain = (await ok("chat.start", { kind: "chat", agentIds: [lead], title: "Research" })).thread.threadId as string;
    await ok("threads.set_mode", { threadId: plain, mode: "auto" });
    chat = plain;
    await openPage(plain);
    const ask = "Launch two subagents. One should search the web and tell me who is responsible for the example.com domain. The other should search the web and tell me which organisation runs the .org top-level domain registry. Then give me both facts.";
    await ok("chat.post", { threadId: plain, body: ask, mentions: [{ kind: "agent", id: lead }] });
    say("person", ask);
    await waitFor("both helper results and the lead's answer", async () => {
      const m = await msgs(plain);
      const results = m.filter((x) => /^Helper "/.test(String(x.body ?? ""))).length;
      const lastResult = m.map((x, i) => (/^Helper "/.test(String(x.body ?? "")) ? i : -1)).reduce((a, b) => Math.max(a, b), -1);
      return results >= 2 && m.slice(lastResult + 1).some((x) => x.author?.kind === "agent" && String(x.body ?? "").length > 20 && !/^Helper "/.test(String(x.body))) ? true : null;
    }, 270_000).catch(() => undefined);
    await sleep(8000);
    const helpers = ((await ok("chat.helpers.list", { threadId: plain })).helpers as any[]);   // eslint-disable-line @typescript-eslint/no-explicit-any
    const all = await msgs(plain);
    const calls = all.flatMap((m) => (m.blocks ?? []).filter((b) => b.type === "tool_call").map((b) => `${b.data?.name}${b.data?.detail ? `: ${b.data.detail}` : ""}`));
    for (const h of helpers) say("HELPER", `${h.title}: ${JSON.stringify((await msgs(h.threadId)).map((m) => [m.author?.kind, String(m.body).slice(0, 300), (m.blocks ?? []).map((b) => `${b.type}:${b.state}`)]))}`);
    say("LOG", hostLines(25).replace(/\n/g, " || ").slice(0, 2500));
    say("RESULT1", `Vyre helpers started: ${helpers.length} (${helpers.map((h) => h.title).join("; ")}); tool calls in the chat: ${calls.join(" | ")}`);
    say("FINAL", JSON.stringify(all.filter((m) => m.author?.kind === "agent" && !/^Started a helper/.test(String(m.body))).at(-1)?.body));
    say("RESULT2", `chat, in order: ${JSON.stringify(all.map((m) => [m.author?.kind === "agent" ? "agent" : "person", String(m.body).slice(0, 60)]))}`);
    say("WARN", hostLines(200).split("\n").filter((l) => /followed|enqueue|wake|could not post/.test(l)).join(" || ").slice(0, 1200));
    if (page) { const t = await page.locator("body").innerText(); say("UI", `"Using agent" shown: ${/Using agent/.test(t)}; "Working with a helper" shown: ${/Working with a helper/.test(t)}`); try { await page.getByText(/steps?/).first().click({ timeout: 3000 }); } catch { /* none */ } await sleep(800); say("shot", await shot("subagents-chat")); }
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
