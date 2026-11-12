// @tsx
// Release gate (12 Nov 2026): a server restart in the middle of a tool command must leave the chat working. Owner rule: "restart the daemon mid-command: the agent's next turn works".
// Four rows: SIGKILL while idle, SIGKILL during `sleep 30`, SIGTERM during `sleep 30`, SIGTERM during a long text reply. After each restart three messages must be answered and each turn must run on a model.
// A real model runs "sleep 30" in the agent's workspace; the daemon is stopped under it (SIGKILL, then SIGTERM in a second chat), started again, and the NEXT message must be answered.
// Found by the gate: after such a restart every turn in the chat fails with the provider's 400 "`model` must be a non-empty string" (the turn row has model ""). Skips without OPENCODE_API_KEY.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { edge, dismissOnboarding } from "./real-app-harness.test.ts";
import { GATE_MODEL, REAL_KEY, SPACE_KIND, addAi, bootGate, claimInBrowser, gateSkip, tokenOf } from "./gate-kit.test.ts";

const ROWS: Array<{ name: string; signal: "SIGKILL" | "SIGTERM"; during: "idle" | "command" | "text" }> = [
  { name: "SIGKILL idle", signal: "SIGKILL", during: "idle" },
  { name: "SIGKILL mid command", signal: "SIGKILL", during: "command" },
  { name: "SIGTERM mid command", signal: "SIGTERM", during: "command" },
  { name: "SIGTERM mid text reply", signal: "SIGTERM", during: "text" },
];
for (const row of ROWS) {
  test(`GATE restart row: ${row.name}, then three messages are answered on a model`, { skip: gateSkip(), timeout: 900_000 }, async () => {
    const { chromium } = await import("playwright-core");
    const d = await bootGate(SPACE_KIND, "Restart Probe");
    const web = await edge(process.env["VYRE_APP_DIST"]!, d.address);
    const browser = await chromium.launch({ executablePath: process.env["CHROME_BIN"] || chromium.executablePath(), args: ["--no-sandbox"] });
    let agentId = "";
    try {
      const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
      const page = await context.newPage();
      await claimInBrowser(page, d.claim!.replace(d.address, web.origin), { name: "Probe Owner", username: "probe", password: "probe walk password 1" });
      await dismissOnboarding(page);
      const token = await tokenOf(page);
      const api = async (cap: string, data: unknown = {}): Promise<any> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
        const r = await context.request.post(`${web.origin}/v1/${cap.replaceAll(".", "/")}`, { headers: { authorization: `Bearer ${token}` }, data: { idempotencyKey: `p-${Math.random()}`, ...(data as object) } });
        const j = (await r.json().catch(() => ({}))) as { data?: unknown };
        assert.equal(r.status(), 200, `${cap}: ${JSON.stringify(j).replaceAll(REAL_KEY, "***").slice(0, 300)}`);
        return j.data;
      };
      await addAi(api);
      const agent = (await api("agents.list")).agents[0] as { agentId: string }; agentId = agent.agentId;
      await api("agents.update", { agentId, patch: { model: GATE_MODEL } });
      const thread = (await api("chat.start", { kind: "chat", agentIds: [agentId], title: "restart probe" })).thread.threadId as string;
      type T = { state: string; model: string; startedAt?: number; error?: { code?: string; message?: string } };
      const turns = async (): Promise<T[]> => ((await api("engine.turns.list", { threadId: thread })).turns ?? []);
      const say = (body: string): Promise<unknown> => api("chat.post", { threadId: thread, body, mentions: [{ kind: "agent", id: agentId }] });
      const idle = async (ms: number): Promise<void> => { const t0 = Date.now(); for (;;) { const t = await turns(); if (t.length > 0 && !t.some((x) => x.state === "running" || x.state === "queued")) return; if (Date.now() - t0 > ms) throw new Error("the chat stayed busy"); await new Promise((r) => setTimeout(r, 500)); } };
      await say("Say OK."); await idle(120_000);
      assert.equal((await turns())[0]!.state, "completed", "the first turn completes");
      if (row.during === "command") { await say("Run `sleep 30 && echo one` in the terminal and tell me what it printed."); await new Promise((r) => setTimeout(r, 12_000)); assert.ok((await turns()).some((x) => x.state === "running"), "the command turn is running when the daemon stops"); }
      if (row.during === "text") { await say("Write 300 numbered lines, each a short fact about deserts. Nothing else."); await new Promise((r) => setTimeout(r, 4_000)); assert.ok((await turns()).some((x) => x.state === "running"), "the reply is streaming when the daemon stops"); }
      await d.stop(row.signal); await new Promise((r) => setTimeout(r, 1500)); await d.start(); await new Promise((r) => setTimeout(r, 6000));
      await idle(120_000);
      const seen: string[] = [];
      for (let i = 1; i <= 3; i++) {
        const tSay = Date.now();
        await say(`Say OK number ${i}.`);
        for (let k = 0; k < 60 && !(await turns()).some((x) => (x.startedAt ?? 0) >= tSay - 1000); k++) await new Promise((r) => setTimeout(r, 500));
        await idle(120_000);
        const last = (await turns()).filter((x) => (x.startedAt ?? 0) >= tSay - 1000)[0];
        assert.ok(last, `a turn was made for message ${i}`);
        seen.push(`${last.state}:${last.model || "NO MODEL"}`);
        assert.equal(last.state, "completed", `message ${i} after the restart is answered; it ended ${last.state}: ${last.error?.message ?? ""}`);
        assert.notEqual(last.model, "", `message ${i} runs on a model`);
      }
      console.log(`GATE RESTART ${row.name}: ${seen.join(" ")}`);
    } finally {
      await browser.close(); web.close(); await d.stop();
      if (agentId !== "") for (const id of execFileSync("docker", ["ps", "-aq", "--filter", `label=vyre.workspace=${agentId}`], { encoding: "utf8" }).split("\n").filter(Boolean)) execFileSync("docker", ["rm", "-f", id]);
    }
  });
}
