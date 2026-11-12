// @tsx
// Release gate (12 Nov 2026): a Team Space whose ONLY AI source is the Space AI key, and a member with no AI account of their own. The member asks their Assistant a plain question and a terminal job, in a private chat and in a channel.
// Must PASS on the final sha; on b0b79d810 it is expected to fail and the failure words a person sees are recorded. Lines start with GATE SPACEKEY. Skips without OPENCODE_API_KEY.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { edge, dismissOnboarding } from "./real-app-harness.test.ts";
import { GATE_MODEL, REAL_KEY, bootGate, claimInBrowser, gateSkip, tokenOf } from "./gate-kit.test.ts";

type Page = import("playwright-core").Page;
const body = async (p: Page): Promise<string> => ((await p.evaluate("document.body.innerText").catch(() => "")) as string).replace(/\n+/g, " | ");

test("GATE Team Space on the Space AI key only: a member with no AI account asks their Assistant", { skip: gateSkip(), timeout: 900_000 }, async () => {
  const { chromium } = await import("playwright-core");
  const shots = path.join(process.env["VYRE_GATE_SHOTS"] ?? "/tmp/vyre-gate-shots", "spacekey"); fs.mkdirSync(shots, { recursive: true });
  const d = await bootGate("team", "Key Studio");
  const web = await edge(process.env["VYRE_APP_DIST"]!, d.address);
  const browser = await chromium.launch({ executablePath: process.env["CHROME_BIN"] || chromium.executablePath(), args: ["--no-sandbox"] });
  const agents: string[] = []; const failures: string[] = [];
  try {
    const octx = await browser.newContext({ viewport: { width: 1280, height: 860 } }); const owner = await octx.newPage();
    await claimInBrowser(owner, d.claim!.replace(d.address, web.origin), { name: "Olivia Owner", username: "olivia", password: "key walk password 1" }); await dismissOnboarding(owner);
    const otoken = await tokenOf(owner);
    const call = async (cap: string, data: unknown = {}, tok = otoken, expect = true): Promise<any> => { const r = await octx.request.post(`${web.origin}/v1/${cap.replaceAll(".", "/")}`, { headers: { authorization: `Bearer ${tok}` }, data: { idempotencyKey: `k-${Math.random()}`, ...(data as object) } }); const j = (await r.json().catch(() => ({}))) as any; if (expect && r.status() !== 200) throw new Error(`${cap}: ${r.status()} ${JSON.stringify(j).replaceAll(REAL_KEY, "***").slice(0, 240)}`); return j.data ?? j; };   // eslint-disable-line @typescript-eslint/no-explicit-any
    await call("providers.space_key.set", { providerKey: "opencode-go", apiKey: REAL_KEY }); await call("engine.models.list", { refresh: true, wait: true });
    const roles = (await call("access.roles.list")).roles as Array<{ id: string; name: string }>;
    const made = await call("members.invites.create", { role: roles.find((r) => r.name === "Member")!.id }); const link = new URL(made.link);
    const mctx = await browser.newContext({ viewport: { width: 1280, height: 860 } }); const mp = await mctx.newPage();
    await mp.goto(web.origin + link.pathname + link.hash, { waitUntil: "load" }); await mp.getByTestId("step-accept").waitFor({ timeout: 20_000 }); await mp.getByTestId("web").click();
    await mp.getByTestId("first").fill("Maya"); await mp.getByTestId("last").fill("Lin"); await mp.getByTestId("next").click();
    await mp.getByTestId("username").fill("maya"); await mp.getByTestId("password").fill("key walk password 1"); await mp.getByTestId("confirm").fill("key walk password 1"); await mp.getByTestId("next").click();
    await mp.getByTestId("device").fill("Gate browser"); await mp.getByTestId("next").click(); await mp.getByTestId("ai-none").click(); await mp.getByTestId("next").click();
    await mp.getByTestId("shell").waitFor({ timeout: 40_000 }); await dismissOnboarding(mp);
    const mtoken = await tokenOf(mp);
    const mine = (await call("agents.list", {}, mtoken)).agents as Array<{ agentId: string; name: string }>; const asst = mine[0]!; agents.push(asst.agentId);
    await call("agents.update", { agentId: asst.agentId, patch: { model: GATE_MODEL } }, mtoken, false);
    const home = (await call("channels.home", {}, mtoken)).channel as { channelId: string; mainThreadId: string };
    const added = await call("channels.agents.add", { channelId: home.channelId, agentId: asst.agentId, mode: "listen" }, mtoken, false); console.log(`GATE SPACEKEY adding the member's Assistant to #vyre as the member: ${JSON.stringify(added).slice(0, 220)}`);
    if (!JSON.stringify(added).includes("channel")) { const viaOwner = await call("channels.agents.add", { channelId: home.channelId, agentId: asst.agentId, mode: "listen" }, otoken, false); console.log(`GATE SPACEKEY adding it as the owner: ${JSON.stringify(viaOwner).slice(0, 220)}`); }
    const ask = async (label: string, threadId: string, text: string, mention: boolean): Promise<void> => {
      const t0 = Date.now();
      await call("chat.post", { threadId, body: text, ...(mention ? { mentions: [{ kind: "agent", id: asst.agentId }] } : {}) }, mtoken, false);
      let state = ""; let err = "";
      for (let i = 0; i < 300; i++) { const t = ((await call("engine.turns.list", { threadId }, mtoken, false)).turns ?? []) as Array<{ state: string; startedAt?: number; error?: { code?: string; message?: string } }>; const mine2 = t.filter((x) => (x.startedAt ?? 0) >= t0 - 1000)[0]; state = mine2?.state ?? "none yet"; err = mine2?.error ? `${mine2.error.code}: ${mine2.error.message}` : ""; if (mine2 && mine2.state !== "running" && mine2.state !== "queued") break; await new Promise((r) => setTimeout(r, 600)); }
      await mp.waitForTimeout(1500); await mp.screenshot({ path: path.join(shots, `${label}.png`) });
      const b = await body(mp); const tail = b.slice(Math.max(0, b.lastIndexOf(text.slice(0, 18))), b.lastIndexOf(text.slice(0, 18)) + 500);
      console.log(`GATE SPACEKEY ${label}: turn ${state} after ${Date.now() - t0} ms${err ? ` error ${err}` : ""}; what the member sees: ${tail}`);
      if (state !== "completed") failures.push(`${label}: ${state} ${err}`);
    };
    const priv = (await call("chat.start", { kind: "chat", agentIds: [asst.agentId], title: "member private" }, mtoken)).thread.threadId as string;
    await mp.goto(`${web.origin}/chats`, { waitUntil: "load" }); await mp.getByTestId("shell").waitFor({ timeout: 30_000 }); await mp.getByText("member private", { exact: true }).first().click().catch(() => undefined); await mp.waitForTimeout(1200);
    await ask("1-private-question", priv, "What is 2 plus 2? Answer in one word.", true);
    await ask("2-private-terminal-job", priv, "Run `echo member-job-ok` in the terminal and tell me what it printed.", true);
    await mp.goto(`${web.origin}/chats`, { waitUntil: "load" }); await mp.getByTestId("shell").waitFor({ timeout: 30_000 }); await mp.getByText(/^#?vyre$/).first().click().catch(() => undefined); await mp.waitForTimeout(1200);
    await ask("3-channel-question", home.mainThreadId, `@${asst.name} what is 3 plus 3? Answer in one word.`, true);
    await ask("4-channel-terminal-job", home.mainThreadId, `@${asst.name} run \`echo channel-job-ok\` in the terminal and tell me what it printed.`, true);
    assert.deepEqual(failures, [], "every ask by the member was answered");
  } finally {
    await browser.close(); web.close(); await d.stop();
    for (const a of agents) for (const id of execFileSync("docker", ["ps", "-aq", "--filter", `label=vyre.workspace=${a}`], { encoding: "utf8" }).split("\n").filter(Boolean)) execFileSync("docker", ["rm", "-f", id]);
  }
});
