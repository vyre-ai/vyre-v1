// @tsx
// Release gate (12 Nov 2026): the Owner can open every terminal session the Assistant made, before and after a daemon restart. In the first walk the Terminals list showed the agent's first session
// ("agent") but terminal.get and terminal.attach answered 404 permission.not_found for it while a later named session opened. This asks for each listed session, three times: after the first
// command, after a second command in a named session, and after a restart on the same data. Skips without OPENCODE_API_KEY.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { edge, dismissOnboarding } from "./real-app-harness.test.ts";
import { GATE_MODEL, REAL_KEY, bootGate, claimInBrowser, gateSkip, tokenOf } from "./gate-kit.test.ts";

test("GATE: the Owner can get and attach every listed terminal session, also after a restart", { skip: gateSkip(), timeout: 600_000 }, async () => {
  const { chromium } = await import("playwright-core");
  const d = await bootGate("personal", "Terminal Probe");
  const web = await edge(process.env["VYRE_APP_DIST"]!, d.address);
  const browser = await chromium.launch({ executablePath: process.env["CHROME_BIN"] || chromium.executablePath(), args: ["--no-sandbox"] });
  let agentId = "";
  try {
    const context = await browser.newContext(); const page = await context.newPage();
    await claimInBrowser(page, d.claim!.replace(d.address, web.origin), { name: "Probe Owner", username: "probe", password: "probe walk password 1" }); await dismissOnboarding(page);
    const token = await tokenOf(page);
    const call = async (cap: string, data: unknown = {}): Promise<{ status: number; data: any }> => { const r = await context.request.post(`${web.origin}/v1/${cap.replaceAll(".", "/")}`, { headers: { authorization: `Bearer ${token}` }, data: { idempotencyKey: `t-${Math.random()}`, ...(data as object) } }); const j = (await r.json().catch(() => ({}))) as any; return { status: r.status(), data: j.data ?? j }; };   // eslint-disable-line @typescript-eslint/no-explicit-any
    await call("providers.add", { providerKey: "opencode-go", connection: "api_key", apiKey: REAL_KEY, scope: "mine" });
    const agent = (await call("agents.list")).data.agents[0] as { agentId: string }; agentId = agent.agentId;
    await call("agents.update", { agentId, patch: { model: GATE_MODEL } });
    const thread = (await call("chat.start", { kind: "chat", agentIds: [agentId], title: "terminal probe" })).data.thread.threadId as string;
    const idle = async (): Promise<void> => { const t0 = Date.now(); for (;;) { const t = ((await call("engine.turns.list", { threadId: thread })).data.turns ?? []) as Array<{ state: string }>; if (t.length > 0 && !t.some((x) => x.state === "running" || x.state === "queued")) return; if (Date.now() - t0 > 120_000) throw new Error("busy"); await new Promise((r) => setTimeout(r, 500)); } };
    const say = async (b: string): Promise<void> => { await call("chat.post", { threadId: thread, body: b, mentions: [{ kind: "agent", id: agentId }] }); await new Promise((r) => setTimeout(r, 1500)); await idle(); };
    const check = async (label: string): Promise<string[]> => {
      const list = (await call("terminal.list", {})).data.terminals ?? (await call("terminal.list", {})).data.sessions ?? [];
      const out: string[] = [];
      for (const s of list as Array<{ terminalId: string; name: string }>) { const g = await call("terminal.get", { terminalId: s.terminalId }); const a = await call("terminal.attach", { terminalId: s.terminalId }); out.push(`${s.name}:${g.status}/${a.status}`); }
      console.log(`GATE TERMINAL ${label}: ${out.join(" ") || "no sessions listed"}`);
      return out;
    };
    await say("Run `echo first` in the terminal.");
    const a = await check("after the first command");
    await say("Run `echo second` in a new terminal session named short.");
    const b = await check("after a named session");
    await d.stop("SIGTERM"); await d.start(); await new Promise((r) => setTimeout(r, 5000));
    const c = await check("after a restart");
    for (const row of [...a, ...b, ...c]) assert.ok(/:200\/200$/.test(row), `every listed session opens for the Owner: ${row}`);
    assert.ok(a.length > 0, "a session is listed");
  } finally {
    await browser.close(); web.close(); await d.stop();
    if (agentId !== "") for (const id of execFileSync("docker", ["ps", "-aq", "--filter", `label=vyre.workspace=${agentId}`], { encoding: "utf8" }).split("\n").filter(Boolean)) execFileSync("docker", ["rm", "-f", id]);
  }
});
