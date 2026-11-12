// @tsx
// Release gate (12 Nov 2026): does a chat broken by the empty-model bug heal on the fixed build? Phase break (run on the OLD build, GATE_HEAL_PHASE=break): break a chat with a restart under `sleep 30`, check the next
// message fails, keep the data directory and write its place, token and ids to GATE_HEAL_FILE. Phase heal (run on the FIXED build, GATE_HEAL_PHASE=heal): start a daemon on that directory and port, send a message in the broken chat.
// Skips without OPENCODE_API_KEY and without a phase.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { edge, dismissOnboarding } from "./real-app-harness.test.ts";
import { GATE_MODEL, REAL_KEY, bootGate, claimInBrowser, gateSkip, tokenOf } from "./gate-kit.test.ts";

const PHASE = process.env["GATE_HEAL_PHASE"] ?? "";
const FILE = process.env["GATE_HEAL_FILE"] ?? "/tmp/gate-heal.json";
const skip = gateSkip() || (PHASE === "" ? "GATE_HEAL_PHASE is not set" : false);
type T = { state: string; model: string; startedAt?: number; error?: { message?: string } };

test(`GATE heal, phase ${PHASE}`, { skip, timeout: 600_000 }, async () => {
  const { chromium } = await import("playwright-core");
  const info = PHASE === "heal" ? JSON.parse(fs.readFileSync(FILE, "utf8")) as { dir: string; port: number; token: string; thread: string; agentId: string } : null;
  const d = info ? await bootGate("personal", "Restart Probe", { dir: info.dir, port: info.port }) : await bootGate("personal", "Restart Probe");
  const web = await edge(process.env["VYRE_APP_DIST"]!, d.address);
  let token = info?.token ?? ""; let agentId = info?.agentId ?? ""; let thread = info?.thread ?? "";
  const browser = await chromium.launch({ executablePath: process.env["CHROME_BIN"] || chromium.executablePath(), args: ["--no-sandbox"] });
  try {
    const context = await browser.newContext(); const page = await context.newPage();
    if (info) { await page.goto(web.origin + "/", { waitUntil: "load" }); await page.getByTestId("si-user").waitFor({ timeout: 30_000 }); await page.getByTestId("si-user").fill("probe"); await page.getByTestId("si-password").fill("probe walk password 1"); await page.getByRole("button", { name: "Sign in" }).click(); await page.getByTestId("shell").waitFor({ timeout: 40_000 }); token = await tokenOf(page); }
    if (!info) { await claimInBrowser(page, d.claim!.replace(d.address, web.origin), { name: "Probe Owner", username: "probe", password: "probe walk password 1" }); await dismissOnboarding(page); token = await tokenOf(page); }
    const api = async (cap: string, data: unknown = {}): Promise<any> => { const r = await context.request.post(`${web.origin}/v1/${cap.replaceAll(".", "/")}`, { headers: { authorization: `Bearer ${token}` }, data: { idempotencyKey: `h-${Math.random()}`, ...(data as object) } }); const j = (await r.json().catch(() => ({}))) as any; assert.equal(r.status(), 200, `${cap}: ${JSON.stringify(j).replaceAll(REAL_KEY, "***").slice(0, 200)}`); return j.data; };   // eslint-disable-line @typescript-eslint/no-explicit-any
    const turns = async (): Promise<T[]> => ((await api("engine.turns.list", { threadId: thread })).turns ?? []);
    const idle = async (): Promise<void> => { const t0 = Date.now(); for (;;) { const t = await turns(); if (t.length > 0 && !t.some((x) => x.state === "running" || x.state === "queued")) return; if (Date.now() - t0 > 120_000) throw new Error("busy"); await new Promise((r) => setTimeout(r, 500)); } };
    const say = async (b: string): Promise<T> => { const t0 = Date.now(); await api("chat.post", { threadId: thread, body: b, mentions: [{ kind: "agent", id: agentId }] }); for (let k = 0; k < 60 && !(await turns()).some((x) => (x.startedAt ?? 0) >= t0 - 1000); k++) await new Promise((r) => setTimeout(r, 500)); await idle(); return (await turns()).filter((x) => (x.startedAt ?? 0) >= t0 - 1000)[0]!; };
    if (!info) {
      await api("providers.add", { providerKey: "opencode-go", connection: "api_key", apiKey: REAL_KEY, scope: "mine" });
      agentId = (await api("agents.list")).agents[0].agentId; await api("agents.update", { agentId, patch: { model: GATE_MODEL } });
      thread = (await api("chat.start", { kind: "chat", agentIds: [agentId], title: "heal probe" })).thread.threadId;
      await say("Say OK."); await api("chat.post", { threadId: thread, body: "Run `sleep 30 && echo one` in the terminal.", mentions: [{ kind: "agent", id: agentId }] });
      await new Promise((r) => setTimeout(r, 12_000));
      await d.stop("SIGKILL"); await d.start(); await new Promise((r) => setTimeout(r, 6000)); await idle();
      const t = await say("Say OK again.");
      console.log(`GATE HEAL break: next message ended ${t.state} on model "${t.model}"`);
      await d.stop("SIGTERM");
      fs.writeFileSync(FILE, JSON.stringify({ dir: d.dir, port: d.port, token, thread, agentId }));
    } else {
      const t = await say("Say OK after the fix.");
      const t2 = await say("Say OK once more.");
      console.log(`GATE HEAL heal: first message ${t.state} on "${t.model}" ${t.error?.message ?? ""}; second ${t2.state} on "${t2.model}" ${t2.error?.message ?? ""}`);
      assert.equal(t.state, "completed", "the broken chat answers on the fixed build");
    }
  } finally {
    await browser.close(); web.close(); await d.stop();
    if (PHASE === "heal" && agentId !== "") for (const id of execFileSync("docker", ["ps", "-aq", "--filter", `label=vyre.workspace=${agentId}`], { encoding: "utf8" }).split("\n").filter(Boolean)) execFileSync("docker", ["rm", "-f", id]);
  }
});
