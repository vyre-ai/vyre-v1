// @tsx
// Release gate: a job that deletes ONE file with `rm -f` finishes with no approval card (rm -f of a single file is no longer held). Real model, Personal Space. Lines start with GATE RMF.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { edge, dismissOnboarding } from "./real-app-harness.test.ts";
import { GATE_MODEL, REAL_KEY, SPACE_KIND, addAi, bootGate, claimInBrowser, gateSkip, tokenOf } from "./gate-kit.test.ts";
const dk = (...a: string[]): string => { try { return execFileSync("docker", a, { encoding: "utf8", timeout: 30_000 }); } catch (e) { return String((e as { stdout?: string }).stdout ?? ""); } };
test("GATE rm -f of one file needs no card", { skip: gateSkip(), timeout: 600_000 }, async () => {
  const { chromium } = await import("playwright-core");
  const d = await bootGate(SPACE_KIND, "Rmf Space"); const web = await edge(process.env["VYRE_APP_DIST"]!, d.address);
  const browser = await chromium.launch({ executablePath: process.env["CHROME_BIN"] || chromium.executablePath(), args: ["--no-sandbox"] });
  let agentId = "";
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } }); const page = await ctx.newPage();
    await claimInBrowser(page, d.claim!.replace(d.address, web.origin), { name: "Rmf Owner", username: "rmf", password: "rmf walk password 1" }); await dismissOnboarding(page);
    const token = await tokenOf(page);
    const call = async (cap: string, data: unknown = {}): Promise<any> => { const r = await ctx.request.post(`${web.origin}/v1/${cap.replaceAll(".", "/")}`, { headers: { authorization: `Bearer ${token}` }, data: { idempotencyKey: `r-${Math.random()}`, ...(data as object) } }); const j = (await r.json().catch(() => ({}))) as any; if (r.status() !== 200) throw new Error(`${cap}: ${r.status()} ${JSON.stringify(j).replaceAll(REAL_KEY, "***").slice(0, 200)}`); return j.data; };   // eslint-disable-line @typescript-eslint/no-explicit-any
    await addAi(call); agentId = (await call("agents.list")).agents[0].agentId as string; await call("agents.update", { agentId, patch: { model: GATE_MODEL } });
    const thread = (await call("chat.start", { kind: "chat", agentIds: [agentId], title: "rmf" })).thread.threadId as string;
    await page.goto(`${web.origin}/chats`, { waitUntil: "load" }); await page.getByTestId("shell").waitFor({ timeout: 30_000 }); await page.getByText("rmf", { exact: true }).first().click().catch(() => undefined); await page.waitForTimeout(1500);
    const t0 = Date.now();
    await call("chat.post", { threadId: thread, body: "Run this in the terminal: `echo hi > ~/one.txt; rm -f ~/one.txt; ls ~/one.txt 2>&1; echo finished-rmf` and tell me what it printed.", mentions: [{ kind: "agent", id: agentId }] });
    let card = false; let state = "";
    for (let i = 0; i < 300; i++) { if (await page.getByRole("button", { name: /^Allow$/ }).count()) card = true; const t = ((await call("engine.turns.list", { threadId: thread })).turns ?? []) as Array<{ state: string }>; state = t[0]?.state ?? ""; if (t.length && !t.some((x) => x.state === "running" || x.state === "queued")) break; await page.waitForTimeout(500); }
    await page.screenshot({ path: `${process.env["VYRE_GATE_SHOTS"] ?? "/tmp"}/rmf-end.png` });
    console.log(`GATE RMF: turn ${state} after ${Date.now() - t0} ms; Allow card seen: ${card}`);
    assert.equal(card, false);
  } finally { await browser.close(); web.close(); await d.stop(); for (const id of dk("ps", "-aq", "--filter", `label=vyre.workspace=${agentId}`).split("\n").filter(Boolean)) dk("rm", "-f", id); }
});
