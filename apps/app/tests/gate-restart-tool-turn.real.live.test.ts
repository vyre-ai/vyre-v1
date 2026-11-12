// @tsx
// Release gate (12 Nov 2026): a server restart in the middle of a tool command must leave the chat working. Owner rule: "restart the daemon mid-command: the agent's next turn works".
// A real model runs "sleep 30" in the agent's workspace; the daemon is stopped under it (SIGKILL, then SIGTERM in a second chat), started again, and the NEXT message must be answered.
// Found by the gate: after such a restart every turn in the chat fails with the provider's 400 "`model` must be a non-empty string" (the turn row has model ""). Skips without OPENCODE_API_KEY.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { edge, dismissOnboarding } from "./real-app-harness.test.ts";
import { GATE_MODEL, REAL_KEY, bootGate, claimInBrowser, gateSkip, tokenOf } from "./gate-kit.test.ts";

for (const signal of ["SIGKILL", "SIGTERM"] as const) {
  test(`GATE: after a ${signal} of the daemon in the middle of a command, the next message is answered`, { skip: gateSkip(), timeout: 600_000 }, async () => {
    const { chromium } = await import("playwright-core");
    const d = await bootGate("personal", "Restart Probe");
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
      await api("providers.add", { providerKey: "opencode-go", connection: "api_key", apiKey: REAL_KEY, scope: "mine" });
      const agent = (await api("agents.list")).agents[0] as { agentId: string }; agentId = agent.agentId;
      await api("agents.update", { agentId, patch: { model: GATE_MODEL } });
      const thread = (await api("chat.start", { kind: "chat", agentIds: [agentId], title: "restart probe" })).thread.threadId as string;
      const turns = async (): Promise<Array<{ state: string; model: string; startedAt?: number; error?: { code?: string; message?: string } }>> => ((await api("engine.turns.list", { threadId: thread })).turns ?? []);
      const say = (body: string): Promise<unknown> => api("chat.post", { threadId: thread, body, mentions: [{ kind: "agent", id: agentId }] });
      const idle = async (ms: number): Promise<void> => { const t0 = Date.now(); for (;;) { const t = await turns(); if (t.length > 0 && !t.some((x) => x.state === "running" || x.state === "queued")) return; if (Date.now() - t0 > ms) throw new Error("the chat stayed busy"); await new Promise((r) => setTimeout(r, 500)); } };
      await say("Say OK."); await idle(120_000);
      assert.equal((await turns())[0]!.state, "completed", "the first turn completes");
      await say("Run `sleep 30 && echo one` in the terminal and tell me what it printed.");
      await new Promise((r) => setTimeout(r, 12_000));
      assert.ok((await turns()).some((x) => x.state === "running"), "the command turn is running when the daemon stops");
      await d.stop(signal); await new Promise((r) => setTimeout(r, 1500)); await d.start(); await new Promise((r) => setTimeout(r, 6000));
      await idle(120_000);
      const tSay = Date.now();
      await say("Say OK again.");
      for (let i = 0; i < 60 && !(await turns()).some((x) => (x.startedAt ?? 0) >= tSay - 1000); i++) await new Promise((r) => setTimeout(r, 500));
      await idle(120_000);
      // the turn made for this message (the interrupted turn's own row, ended host_lost, is older)
      const t = (await turns()).filter((x) => (x.startedAt ?? 0) >= tSay - 1000);
      assert.ok(t.length > 0, "a turn was made for the next message");
      const last = t[0]!;
      assert.equal(last.state, "completed", `the next message is answered after the restart; it ended ${last.state}: ${last.error?.message ?? ""}`);
      assert.notEqual(last.model, "", "the turn runs on a model");
    } finally {
      await browser.close(); web.close(); await d.stop();
      if (agentId !== "") for (const id of execFileSync("docker", ["ps", "-aq", "--filter", `label=vyre.workspace=${agentId}`], { encoding: "utf8" }).split("\n").filter(Boolean)) execFileSync("docker", ["rm", "-f", id]);
    }
  });
}
