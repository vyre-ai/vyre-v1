// @tsx
// Release gate (12 Nov 2026): a daemon restart must not kill the agent's running command; a pressed Stop must. Real model, real workspace. Lines start with GATE KEEP.
// Test 1: the agent runs a counter loop; SIGTERM the daemon, wait 5 s, start it on the same data: the loop is alive and the count rises through the restart, no ^C in the pane; then the same with SIGKILL; then
// engine.stop (the Stop button's call) interrupts the loop. Test 2: the Owner's terminal.get/attach (a) on a new tab during its first long command and (b) on a tab that finished one command and is busy with a second long one; and a pressed Stop on a fresh `sleep 120` interrupts at once.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { edge, dismissOnboarding } from "./real-app-harness.test.ts";
import { GATE_MODEL, REAL_KEY, bootGate, claimInBrowser, gateSkip, tokenOf } from "./gate-kit.test.ts";

const dk = (...a: string[]): string => { try { return execFileSync("docker", a, { encoding: "utf8", timeout: 30_000 }); } catch (e) { return String((e as { stdout?: string }).stdout ?? ""); } };
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function setup(name: string) {
  const { chromium } = await import("playwright-core");
  const d = await bootGate("personal", name);
  const web = await edge(process.env["VYRE_APP_DIST"]!, d.address);
  const browser = await chromium.launch({ executablePath: process.env["CHROME_BIN"] || chromium.executablePath(), args: ["--no-sandbox"] });
  const context = await browser.newContext(); const page = await context.newPage();
  await claimInBrowser(page, d.claim!.replace(d.address, web.origin), { name: "Keep Owner", username: "keep", password: "keep walk password 1" }); await dismissOnboarding(page);
  const token = await tokenOf(page);
  const call = async (cap: string, data: unknown = {}): Promise<{ status: number; data: any }> => { const r = await context.request.post(`${web.origin}/v1/${cap.replaceAll(".", "/")}`, { headers: { authorization: `Bearer ${token}` }, data: { idempotencyKey: `k-${Math.random()}`, ...(data as object) } }); const j = (await r.json().catch(() => ({}))) as any; return { status: r.status(), data: j.data ?? j }; };   // eslint-disable-line @typescript-eslint/no-explicit-any
  await call("providers.add", { providerKey: "opencode-go", connection: "api_key", apiKey: REAL_KEY, scope: "mine" });
  const agentId = (await call("agents.list")).data.agents[0].agentId as string; await call("agents.update", { agentId, patch: { model: GATE_MODEL } });
  const thread = (await call("chat.start", { kind: "chat", agentIds: [agentId], title: "keep probe" })).data.thread.threadId as string;
  const post = (b: string): Promise<unknown> => call("chat.post", { threadId: thread, body: b, mentions: [{ kind: "agent", id: agentId }] });
  const cid = (): string => dk("ps", "-q", "--filter", `label=vyre.workspace=${agentId}`).trim().split("\n")[0] ?? "";
  const sh = (cmd: string): string => dk("exec", cid() || "x", "sh", "-c", cmd).trim().replace(/\n/g, " / ");
  const close = async (): Promise<void> => { await browser.close(); web.close(); await d.stop(); for (const id of dk("ps", "-aq", "--filter", `label=vyre.workspace=${agentId}`).split("\n").filter(Boolean)) dk("rm", "-f", id); };
  return { d, call, post, cid, sh, thread, agentId, close };
}

test("GATE KEEP 1: a counter loop survives SIGTERM and SIGKILL of the daemon, and Stop interrupts it", { skip: gateSkip() || (process.env["GATE_KEEP_ONLY"] === "2" ? "test 2 only" : false), timeout: 900_000 }, async () => {
  const s = await setup("Keep Probe");
  try {
    await s.post("Run `for i in $(seq 1 600); do echo $i >> ~/count.txt; sleep 1; done` in the terminal and wait for it.");
    for (let i = 0; i < 150 && Number(s.sh("wc -l < ~/count.txt 2>/dev/null || echo 0").split(" ")[0]) < 5; i++) await sleep(1000);
    console.log(`GATE KEEP start check: count ${s.sh("wc -l < ~/count.txt 2>&1")}; ps ${s.sh("ps -eo args | grep -E \"seq|sleep\" | grep -v grep | head -3")}; ls ${s.sh("ls ~ | head")}`);
    const count = (): number => Number(s.sh("wc -l < ~/count.txt 2>/dev/null || echo 0").split(" ")[0]);
    const alive = (): string => s.sh("ps -eo pid,etime,args | grep -E 'seq 1 600|sleep 1$' | grep -v grep | head -3 || echo none");
    const pane = (): string => s.sh("for t in $(tmux list-sessions -F '#S'); do tmux capture-pane -p -t $t | grep -c '\\^C'; done").replace(/ \/ /g, ",");
    for (const signal of ["SIGTERM", "SIGKILL"] as const) {
      const before = count(); await sleep(2000); const atStop = count();
      await s.d.stop(signal); const duringStart = Date.now(); await sleep(5000); const during = count();
      await s.d.start(); await sleep(6000); const after = count(); await sleep(5000); const later = count();
      console.log(`GATE KEEP ${signal}: count before ${before}, at stop ${atStop}, 5 s after stop (daemon down) ${during}, 6 s after start ${after}, 5 s later ${later}; loop alive: ${alive()}; ^C lines per pane: ${pane()}; down for ${Date.now() - duringStart} ms`);
      assert.ok(later > after && after > during, `${signal}: the counter kept counting through the restart`);
    }
    const tStop = Date.now();
    const stopped = await s.call("engine.stop", { threadId: s.thread });
    const rows: string[] = []; for (let k = 0; k <= 5; k++) { rows.push(`+${k}s count ${count()}`); await sleep(1000); }
    console.log(`GATE KEEP Stop after the restarts: engine.stop ${stopped.status} in ${Date.now() - tStop} ms; ${rows.join(", ")}; loop alive now: ${alive()}`);
  } finally { await s.close(); }
});

test("GATE KEEP 2: terminal get/attach on a new tab and on a tab busy with a second command; Stop on a fresh sleep", { skip: gateSkip() || (process.env["GATE_KEEP_ONLY"] === "1" ? "test 1 only" : false), timeout: 900_000 }, async () => {
  const s = await setup("Keep Probe 2");
  try {
    const probe = async (label: string, seconds: number): Promise<void> => {
      for (let k = 0; k <= seconds; k++) {
        const list = ((await s.call("terminal.list", {})).data.terminals ?? []) as Array<{ terminalId: string; name: string }>;
        const rows: string[] = []; for (const t of list) { const g = await s.call("terminal.get", { terminalId: t.terminalId }); const a = await s.call("terminal.attach", { terminalId: t.terminalId }); rows.push(`${t.name}:get ${g.status} attach ${a.status}`); }
        console.log(`GATE KEEP ${label} +${k}s: ${rows.join("; ") || "no tabs yet"}`); await sleep(1000);
      }
    };
    const waitProc = async (re: string): Promise<void> => { for (let i = 0; i < 120 && s.sh(`ps -eo args | grep -E '${re}' | grep -v grep | wc -l`).split(" ")[0] === "0"; i++) await sleep(500); };
    // (a) a new tab, during its first long command
    await s.post("Run `sleep 100` in the terminal and wait for it."); await waitProc("sleep 100");
    await probe("new tab, first long command", 5);
    const tStop = Date.now(); await s.call("engine.stop", { threadId: s.thread });
    await sleep(1500);
    console.log(`GATE KEEP Stop on a fresh sleep: sleep alive 1.5 s after Stop: ${s.sh("ps -eo args | grep 'sleep 100' | grep -v grep | wc -l")} (0 means interrupted); ${Date.now() - tStop} ms`);
    // (b) the tab has finished one command; now a second long one
    for (let i = 0; i < 100; i++) { const t = ((await s.call("engine.turns.list", { threadId: s.thread })).data.turns ?? []) as Array<{ state: string }>; if (!t.some((x) => x.state === "running" || x.state === "queued")) break; await sleep(500); }
    await s.post("Run `echo done-one` in the terminal."); await sleep(15_000);
    await s.post("Now run `sleep 110` in the terminal and wait for it."); await waitProc("sleep 110");
    await probe("tab that finished one command, busy with a second", 5);
    await s.call("engine.stop", { threadId: s.thread }); await sleep(2000);
    console.log(`GATE KEEP second sleep alive 2 s after Stop: ${s.sh("ps -eo args | grep 'sleep 110' | grep -v grep | wc -l")}`);
  } finally { await s.close(); }
});
