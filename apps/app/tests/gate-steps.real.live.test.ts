// @tsx
// Release gate (12 Nov 2026): what the chat row says while a command runs, and what a helper's row says. Real model. A `sleep 30` job by the Assistant, then a helper running `sleep 40`. Shots at 1280 and 390 wide,
// and the exact words of the row, go to VYRE_GATE_SHOTS/steps. Lines start with GATE STEPS. Skips without OPENCODE_API_KEY.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { edge, dismissOnboarding } from "./real-app-harness.test.ts";
import { GATE_MODEL, REAL_KEY, SPACE_KIND, addAi, bootGate, claimInBrowser, gateSkip, tokenOf } from "./gate-kit.test.ts";

const dk = (...a: string[]): string => { try { return execFileSync("docker", a, { encoding: "utf8", timeout: 30_000 }); } catch (e) { return String((e as { stdout?: string }).stdout ?? ""); } };

test("GATE steps: the rows while a command runs", { skip: gateSkip(), timeout: 900_000 }, async () => {
  const { chromium } = await import("playwright-core");
  const shots = path.join(process.env["VYRE_GATE_SHOTS"] ?? "/tmp/vyre-gate-shots", "steps"); fs.mkdirSync(shots, { recursive: true });
  const d = await bootGate(SPACE_KIND, "Steps Space");
  const web = await edge(process.env["VYRE_APP_DIST"]!, d.address);
  const browser = await chromium.launch({ executablePath: process.env["CHROME_BIN"] || chromium.executablePath(), args: ["--no-sandbox"] });
  let agentId = "";
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } }); const page = await ctx.newPage();
    await claimInBrowser(page, d.claim!.replace(d.address, web.origin), { name: "Steps Owner", username: "steps", password: "steps walk password 1" }); await dismissOnboarding(page);
    const token = await tokenOf(page);
    const call = async (cap: string, data: unknown = {}): Promise<any> => { const r = await ctx.request.post(`${web.origin}/v1/${cap.replaceAll(".", "/")}`, { headers: { authorization: `Bearer ${token}` }, data: { idempotencyKey: `s-${Math.random()}`, ...(data as object) } }); const j = (await r.json().catch(() => ({}))) as any; if (r.status() !== 200) throw new Error(`${cap}: ${r.status()} ${JSON.stringify(j).replaceAll(REAL_KEY, "***").slice(0, 200)}`); return j.data; };   // eslint-disable-line @typescript-eslint/no-explicit-any
    await addAi(call);
    agentId = (await call("agents.list")).agents[0].agentId as string; await call("agents.update", { agentId, patch: { model: GATE_MODEL } });
    const thread = (await call("chat.start", { kind: "chat", agentIds: [agentId], title: "steps" })).thread.threadId as string;
    await page.goto(`${web.origin}/chats`, { waitUntil: "load" }); await page.getByTestId("shell").waitFor({ timeout: 30_000 }); await page.getByText("steps", { exact: true }).first().click().catch(() => undefined); await page.waitForTimeout(1500);
    const post = (b: string): Promise<unknown> => call("chat.post", { threadId: thread, body: b, mentions: [{ kind: "agent", id: agentId }] });
    const body = async (): Promise<string> => ((await page.evaluate("document.body.innerText").catch(() => "")) as string).replace(/\n+/g, " | ");
    const cid = (): string => dk("ps", "-q", "--filter", `label=vyre.workspace=${agentId}`).trim().split("\n")[0] ?? "";
    const running = (re: string): boolean => dk("exec", cid() || "x", "sh", "-c", `ps -eo args | grep -E '${re}' | grep -v grep | wc -l`).trim() !== "0";
    const grab = async (label: string, marker: string): Promise<void> => {
      const seen = new Set<string>();
      for (let i = 0; i < 12; i++) { const b = await body(); const j = b.lastIndexOf("Assistant"); seen.add(b.slice(j, j + 200)); await page.waitForTimeout(700); }
      await page.screenshot({ path: path.join(shots, `${label}-wide.png`) });
      await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(1200);
      await page.screenshot({ path: path.join(shots, `${label}-narrow.png`) });
      const nb = await body(); const nj = nb.lastIndexOf("Assistant");
      await page.setViewportSize({ width: 1280, height: 860 }); await page.waitForTimeout(800);
      console.log(`GATE STEPS ${label}: while ${marker} runs the row says (distinct readings, wide): ${[...seen].join(" // ")}; narrow: ${nb.slice(nj, nj + 200)}`);
    };
    await post("Run `sleep 30 && echo steps-done` in the terminal and tell me when it finishes.");
    for (let i = 0; i < 120 && !running("sleep 30"); i++) await page.waitForTimeout(500);
    await page.waitForTimeout(3000);
    await grab("1-assistant-command", "sleep 30");
    for (let i = 0; i < 200; i++) { const t = ((await call("engine.turns.list", { threadId: thread })).turns ?? []) as Array<{ state: string }>; if (!t.some((x) => x.state === "running" || x.state === "queued")) break; await page.waitForTimeout(500); }
    await post("Start one helper to run `sleep 40 && echo helper-done` in its terminal, and tell me when it reports.");
    for (let i = 0; i < 160 && !running("sleep 40"); i++) await page.waitForTimeout(500);
    await page.waitForTimeout(3000);
    await grab("2-helper-command", "the helper's sleep 40");
    assert.ok(thread);
  } finally {
    await browser.close(); web.close(); await d.stop();
    if (agentId !== "") for (const id of dk("ps", "-aq", "--filter", `label=vyre.workspace=${agentId}`).split("\n").filter(Boolean)) dk("rm", "-f", id);
  }
});
