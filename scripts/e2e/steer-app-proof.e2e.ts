// Steering proof in the real app on the real Claude CLI: a booted daemon on a temp Space, the person's Claude setup token as the AI account, a plain new chat opened in the Chats screen in real Chrome. Two replies of about 300
// words are asked for; a watcher measures, from the moment Send is pressed, when the Working sign (stop button) shows, when the first word shows, how many distinct lengths the agent's message goes through,
// and whether any memory card or "Used N memories" line shows; one picture mid-reply per prompt. NOT part of any CI glob. Needs VYRE_TEST_CLAUDE_SETUP_TOKEN, VYRE_APP_DIST, CHROME_BIN.
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fakePlatform } from "../../host/src/platform/index.ts";
import type { FetchFn } from "../../host/src/platform/probes.ts";
import { loadConfig } from "../../host/src/daemon/config.ts";
import { CODE_ROOT, startDaemon } from "../../host/src/daemon/daemon.ts";
import { claimOnEdge, dismissOnboarding, edge } from "../../apps/app/tests/real-app-harness.test.ts";

const TOKEN = process.env["VYRE_TEST_CLAUDE_SETUP_TOKEN"] ?? "";
const DIST = process.env["VYRE_APP_DIST"] ?? "";
const CHROME = process.env["CHROME_BIN"] ?? "";
if (!TOKEN || !DIST || !CHROME) throw new Error("VYRE_TEST_CLAUDE_SETUP_TOKEN, VYRE_APP_DIST and CHROME_BIN are required");
const OUT = process.env["E2E_OUT"] ?? "/private/tmp/claude-501/-Users-irfad-Claude/244d818f-f61b-4448-8728-ddfc2a911874/scratchpad/streaming-proof";
fs.mkdirSync(OUT, { recursive: true });
const scrub = (s: string): string => s.split(TOKEN).join("[token]").replace(/sk-ant-[A-Za-z0-9_-]{6,}/g, "[token]");
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const lines: string[] = [];
const say = (t: string): void => { const l = scrub(t); lines.push(l); console.log(l.slice(0, 500)); };

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-e2e-stream-"));
const d = await startDaemon({
  config: loadConfig(["--data-dir", dir, "--port", "0", "--space", "spc_stream", "--space-name", "Stream", "--space-kind", "personal"], {}, "1.2.3"), codeRoot: CODE_ROOT,
  platform: fakePlatform({ os: process.platform === "darwin" ? "darwin" : "linux", hostname: "e2e-stream", free: 80e9, commands: {
    [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" }, "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" }, "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
  } }),
  fetch: caddyFetch, intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
});
let n = 0;
async function ok(cap: string, input: Record<string, unknown> = {}): Promise<any> {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${d.token}` }, body: JSON.stringify({ idempotencyKey: `sp-${++n}`, ...input }) });
  const body = (await r.json()) as { data?: unknown };
  if (r.status !== 200) throw new Error(`${cap}: ${scrub(JSON.stringify(body)).slice(0, 300)}`);
  return body.data;
}

async function main(): Promise<void> {
  let web: Awaited<ReturnType<typeof edge>> | null = null;
  try {
    const { chromium } = await import("playwright-core");
    web = await edge(DIST, d.url);
    const browser = await chromium.launch({ executablePath: CHROME });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(claimOnEdge(d.claim!.url, web.origin));
    await page.getByTestId("claim-name").fill("Stream owner");
    await page.getByTestId("claim-username").fill("streamowner");
    await page.getByTestId("claim-password").fill("fixture stream password123");
    await page.getByTestId("claim-confirm").fill("fixture stream password123");
    await page.getByTestId("claim-next").click();
    await page.getByTestId("claim-saved").click();
    await page.getByTestId("claim-create").click();
    await dismissOnboarding(page).catch(async (e: Error) => { const ids = await page.evaluate(() => [...document.querySelectorAll("[data-testid]")].map((x) => x.getAttribute("data-testid")).slice(0, 30).join(",")); const err = await page.getByTestId("claim-error").innerText().catch(() => ""); throw new Error(`${e.message.split("\n")[0]} :: ${ids} :: ${err}`); });
    const unlock = await fetch(`${d.url}/local/vault/key/unlock`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${d.token}` }, body: JSON.stringify({ key: Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(32))).toString("base64") }) });
    if (unlock.status !== 204) throw new Error(`unlock ${unlock.status}`);
    const accounts = (await ok("vault.folders.create", { name: "Accounts", scope: "mine" })).folder.id as string;
    const flow = await ok("providers.subscription_start", { providerKey: "claude-code" });
    await ok("vault.item.put", { folderId: accounts, name: "Claude setup", kind: "ai_subscription", fields: [{ key: "setup_token", value: TOKEN, secret: true }] });
    const provider = (await ok("providers.subscription_complete", { flowId: flow.flowId })).provider;
    await ok("providers.set_space_use", { providerId: provider.id, allow: true });
    await ok("engine.pool.status");
    const agentId = (await ok("agents.create", { name: "Assistant", role: "You are a helpful assistant." })).agent.agentId as string;
    const threadId = (await ok("chat.start", { kind: "chat", agentIds: [agentId] })).thread.threadId as string;
    say(`setup: temp Space spc_stream, AI account ${provider.providerKey} (${provider.state}), a plain chat ${threadId.slice(0, 8)}`);

    await page.goto(`${web.origin}/chat#screen=chats.conversation&threadId=${threadId}`);
    await page.getByTestId("composer-field").waitFor({ timeout: 20_000 }).catch(async (e: Error) => { const ids = await page.evaluate(() => [...document.querySelectorAll("[data-testid]")].map((x) => x.getAttribute("data-testid")).slice(0, 50).join(",")); const cause = await page.getByTestId("state-cause").innerText().catch(() => ""); const details = await page.getByTestId("state-details").innerText().catch(() => ""); throw new Error(`${e.message.split("\n")[0]} at ${page.url().split("#")[0]} cause: ${cause} details: ${details.slice(0, 300)}`); });

    await ok("threads.set_mode", { threadId, mode: "auto" });
    const field = page.getByTestId("composer-field");
    const send = async (text: string): Promise<void> => { await field.click(); await field.fill(text); await page.getByTestId("composer-send").click(); };
    const agentReplies = async (): Promise<string[]> => ((await ok("chat.messages.list", { threadId })).messages as Array<{ author?: { kind?: string }; body?: string }>).filter((m) => m.author?.kind === "agent" && (m.body ?? "") !== "").map((m) => m.body ?? "");
    const t0 = Date.now();
    const at = (): string => `+${((Date.now() - t0) / 1000).toFixed(1)}s`;
    await send("Use the Bash tool to run `sleep 9; echo one`, then `sleep 9; echo two`, then `sleep 9; echo three`, each as its own Bash call, one after another, then reply with the word FINISHED.");
    say(`${at()} sent the task`);
    // wait until the agent is working (Working sign) and has begun its first command
    for (let i = 0; i < 400 && (await page.getByTestId("stop-button").count()) === 0; i++) await sleep(50);
    await sleep(6000);
    say(`${at()} agent is working; composer placeholder: ${JSON.stringify(await field.getAttribute("placeholder"))}`);
    await send("Change of plan: do not run any more commands. Reply with exactly the single word STEERED and nothing else.");
    say(`${at()} sent the steering message`);
    // the row appears once the post is confirmed; its picture is taken then, and the time it stays is measured against the agent's first command ending (about 9 s after it began)
    let shownAt = -1, rowGoneAt = -1;
    for (let i = 0; i < 2000; i++) {
      const rows = await page.getByTestId("queue-row").count();
      if (shownAt < 0 && rows > 0 && (await page.getByTestId("queue-edit").count()) > 0) { shownAt = Date.now() - t0; say(`${at()} waiting row: ${JSON.stringify(await page.getByTestId("queue-row").innerText().catch(() => ""))}`); await page.screenshot({ path: path.join(OUT, "waiting-row.png") }); }
      if (shownAt >= 0 && rowGoneAt < 0 && rows === 0) { rowGoneAt = Date.now() - t0; say(`${at()} the waiting row is gone`); await page.screenshot({ path: path.join(OUT, "row-gone.png") }); }
      if ((await agentReplies()).length > 0 && (await page.getByTestId("stop-button").count()) === 0) break;
      await sleep(100);
    }
    await sleep(2500);
    const replies = await agentReplies();
    say(`${at()} done. agent replies saved: ${replies.length}: ${JSON.stringify(replies.map((r) => r.slice(0, 80)))}`);
    say(`verdict: steered=${replies.some((r) => /STEERED/.test(r))} sawFinished=${replies.some((r) => /FINISHED/.test(r))} doubleAnswer=${replies.length > 1} rowShown=${shownAt >= 0} rowGone=${rowGoneAt >= 0}`);
    await page.screenshot({ path: path.join(OUT, "final.png") });
    await browser.close();
  } catch (e) {
    say(`ERROR ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  } finally {
    web?.close();
    fs.writeFileSync(path.join(OUT, "result.md"), `# Streaming proof (real Claude CLI)\n\n${lines.join("\n\n")}\n`);
    try { await d.stop(); } catch { /* closing */ }
    fs.rmSync(dir, { recursive: true, force: true });
    void DatabaseSync;
    process.exit(process.exitCode ?? 0);
  }
}
await main();
