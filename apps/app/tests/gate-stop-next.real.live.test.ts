// @tsx
// Release gate (12 Nov 2026): Stop on a long command, then the next ask. Real model, real workspace. Stop is pressed about 10 s into `sleep 120 && echo finished-long` (the engine's stop, the call the Stop button makes);
// right after it, and every second for ten seconds, the Owner calls terminal.get and terminal.attach on every session; the workspace's process list and tmux panes are read; then `echo next-ok` is asked and timed.
// Second test: a background server started earlier in the same turn (`python3 -m http.server 8080 &`) must still serve after the Stop. Lines start with GATE STOP. Skips without OPENCODE_API_KEY.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { edge, dismissOnboarding } from "./real-app-harness.test.ts";
import { GATE_MODEL, REAL_KEY, bootGate, claimInBrowser, gateSkip, tokenOf } from "./gate-kit.test.ts";

const dk = (...a: string[]): string => { try { return execFileSync("docker", a, { encoding: "utf8", timeout: 30_000 }); } catch (e) { return String((e as { stdout?: string }).stdout ?? ""); } };

for (const variant of ["plain", "background-server"] as const) {
  test(`GATE stop then next ask: ${variant}`, { skip: gateSkip(), timeout: 900_000 }, async () => {
    const { chromium } = await import("playwright-core");
    const d = await bootGate("personal", "Stop Probe");
    const web = await edge(process.env["VYRE_APP_DIST"]!, d.address);
    const browser = await chromium.launch({ executablePath: process.env["CHROME_BIN"] || chromium.executablePath(), args: ["--no-sandbox"] });
    let agentId = "";
    try {
      const context = await browser.newContext(); const page = await context.newPage();
      await claimInBrowser(page, d.claim!.replace(d.address, web.origin), { name: "Stop Owner", username: "stop", password: "stop walk password 1" }); await dismissOnboarding(page);
      const token = await tokenOf(page);
      const call = async (cap: string, data: unknown = {}): Promise<{ status: number; data: any }> => { const r = await context.request.post(`${web.origin}/v1/${cap.replaceAll(".", "/")}`, { headers: { authorization: `Bearer ${token}` }, data: { idempotencyKey: `s-${Math.random()}`, ...(data as object) } }); const j = (await r.json().catch(() => ({}))) as any; return { status: r.status(), data: j.data ?? j }; };   // eslint-disable-line @typescript-eslint/no-explicit-any
      await call("providers.add", { providerKey: "opencode-go", connection: "api_key", apiKey: REAL_KEY, scope: "mine" });
      agentId = (await call("agents.list")).data.agents[0].agentId; await call("agents.update", { agentId, patch: { model: GATE_MODEL } });
      const thread = (await call("chat.start", { kind: "chat", agentIds: [agentId], title: "stop probe" })).data.thread.threadId as string;
      type T = { state: string; startedAt?: number };
      const turns = async (): Promise<T[]> => ((await call("engine.turns.list", { threadId: thread })).data.turns ?? []);
      const idle = async (ms = 300_000): Promise<void> => { const t0 = Date.now(); for (;;) { const t = await turns(); if (t.length > 0 && !t.some((x) => x.state === "running" || x.state === "queued")) return; if (Date.now() - t0 > ms) throw new Error("busy"); await new Promise((r) => setTimeout(r, 400)); } };
      const post = (b: string): Promise<unknown> => call("chat.post", { threadId: thread, body: b, mentions: [{ kind: "agent", id: agentId }] });
      const replyAfter = async (t0: number): Promise<string> => ((await call("chat.messages.list", { threadId: thread })).data.messages as Array<{ author: { kind: string }; body: string }>).filter((m) => m.author.kind === "agent").map((m) => m.body).join("\n");
      void replyAfter;
      const cid = (): string => dk("ps", "-q", "--filter", `label=vyre.workspace=${agentId}`).trim().split("\n")[0] ?? "";
      await post("Say OK."); await idle(120_000);
      if (variant === "plain") await post("Run `sleep 120 && echo finished-long` in the terminal and tell me when it is done.");
      else await post("First start a web server in the background with `python3 -m http.server 8080 &` (in the terminal), then run `sleep 120 && echo finished-long` in the foreground, and tell me when it is done.");
      let tBusy = Date.now(); for (let i = 0; i < 100; i++) { if (dk("exec", cid() || "x", "sh", "-c", "ps -eo args | grep -c 'sleep 120' ").trim() > "1") break; await new Promise((r) => setTimeout(r, 300)); }
      await new Promise((r) => setTimeout(r, Math.max(0, 10_000 - (Date.now() - tBusy))));
      const tStop = Date.now();
      const stopped = await call("engine.stop", { threadId: thread });
      console.log(`GATE STOP ${variant}: engine.stop answered ${stopped.status} after ${Date.now() - tStop} ms`);
      const c = cid();
      const snap = (): string => dk("exec", c, "sh", "-c", "ps -eo pid,etime,args | grep -E 'sleep 120|http.server' | grep -v grep || echo none").trim().replace(/\n/g, " / ");
      const pane = (): string => dk("exec", c, "sh", "-c", "for s in $(tmux list-sessions -F '#S'); do echo \"[$s]\"; tmux capture-pane -p -t $s | grep -v '^$' | tail -5; done").trim().replace(/\n/g, " / ").slice(0, 500);
      for (let s = 0; s <= 10; s++) {
        const list = ((await call("terminal.list", {})).data.terminals ?? []) as Array<{ terminalId: string; name: string }>;
        const rows: string[] = [];
        for (const t of list) { const g = await call("terminal.get", { terminalId: t.terminalId }); const a = await call("terminal.attach", { terminalId: t.terminalId }); rows.push(`${t.name}:get ${g.status} attach ${a.status}`); }
        console.log(`GATE STOP ${variant} +${s}s: ${rows.join("; ") || "no sessions"} | ps: ${snap()}`);
        if (s === 0 || s === 3) console.log(`GATE STOP ${variant} +${s}s pane: ${pane()}`);
        await new Promise((r) => setTimeout(r, 1000 - ((Date.now() - tStop) % 1000)));
      }
      await idle(60_000).catch(() => undefined);
      const tNext = Date.now();
      await post("Run `echo next-ok` and tell me what it printed.");
      for (let k = 0; k < 40 && !(await turns()).some((x) => (x.startedAt ?? 0) >= tNext - 1000); k++) await new Promise((r) => setTimeout(r, 300));
      await idle(300_000);
      const answeredAfterStop = Date.now() - tStop; const answeredAfterAsk = Date.now() - tNext;
      const all = await replyAfter(tStop);
      console.log(`GATE STOP ${variant}: next-ok answered ${answeredAfterAsk} ms after the ask, ${answeredAfterStop} ms after Stop; finished-long in any reply: ${/finished-long/.test(all.split("next-ok")[0] ?? "") || /printed finished-long|finished-long\b/.test(all)}; ps now: ${snap()}; pane: ${pane()}`);
      if (variant === "background-server") console.log(`GATE STOP background-server: server still answers: ${dk("exec", c, "sh", "-c", "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/ || echo none").trim()}`);
      assert.ok(answeredAfterAsk < 60_000, `the next ask is answered quickly (${answeredAfterAsk} ms)`);
    } finally {
      await browser.close(); web.close(); await d.stop();
      if (agentId !== "") for (const id of dk("ps", "-aq", "--filter", `label=vyre.workspace=${agentId}`).split("\n").filter(Boolean)) dk("rm", "-f", id);
    }
  });
}
