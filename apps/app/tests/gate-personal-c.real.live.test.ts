// @tsx
// Release gate, part C, Personal Space (12 Nov 2026): a real model doing real work in its own Docker workspace (tmux), in the production web export. Each job is asked in plain words, the chat and the
// Terminal are watched, every wait a person would feel is timed, and every silent gap over 5 s is written down. Skips without OPENCODE_API_KEY. Needs Docker and the workspace image.
// Rows and shots go to VYRE_GATE_SHOTS/c-personal. Nothing here prints the key.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { edge, dismissOnboarding } from "./real-app-harness.test.ts";
import { guardCrashes } from "./crash-guard.ts";
import { GATE_MODEL, REAL_KEY, bootGate, claimInBrowser, gateSkip, recorder, tokenOf } from "./gate-kit.test.ts";

const PASSWORD = "gate walk password 4417";
type Msg = { author: { kind: string; id: string }; body: string; blocks?: Array<{ type: string; state?: string; data?: Record<string, unknown> }> };
const docker = (...a: string[]): string => { try { return execFileSync("docker", a, { encoding: "utf8", timeout: 60_000 }); } catch (e) { return String((e as { stdout?: string }).stdout ?? ""); } };
const ONLY = (process.env["GATE_C_ONLY"] ?? "").split(",").filter(Boolean);
const NOISE = /terminal_run|tool_call|tool_result|\bexit code\b|"ok":|\bundefined\b|\[object|stack trace|ENOENT|Error:/i;

test("GATE C (Personal Space): the agent works in its tmux workspace", { skip: gateSkip(), timeout: 2_400_000 }, async () => {
  const { chromium } = await import("playwright-core");
  const exe = process.env["CHROME_BIN"] || chromium.executablePath();
  assert.ok(fs.existsSync(exe), `Chromium is required at ${exe}`);
  const shots = path.join(process.env["VYRE_GATE_SHOTS"] ?? "/tmp/vyre-gate-shots", "c-personal"); fs.mkdirSync(shots, { recursive: true });
  const rec = recorder(shots, "rows.json");
  let agentId = "";
  const d = await bootGate("personal", "Gate Personal");
  const web = await edge(process.env["VYRE_APP_DIST"]!, d.address);
  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  const failures: string[] = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    const page = await context.newPage();
    const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
    const guard = guardCrashes(page);
    const shot = async (name: string): Promise<string> => { await page.evaluate("new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))").catch(() => undefined); await page.screenshot({ path: path.join(shots, `${name}.png`) }).catch(() => undefined); return `${name}.png`; };
    const body = async (): Promise<string> => ((await page.evaluate("document.body.innerText").catch(() => "")) as string).replace(/\n+/g, " | ");
    await claimInBrowser(page, d.claim!.replace(d.address, web.origin), { name: "Gate Owner", username: "gateowner", password: PASSWORD });
    await dismissOnboarding(page);
    await page.getByTestId("shell").waitFor({ timeout: 30_000 });
    const token = await tokenOf(page);
    const api = async (cap: string, data: unknown = {}, expect = 200): Promise<any> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
      const r = await context.request.post(`${web.origin}/v1/${cap.replaceAll(".", "/")}`, { headers: { authorization: `Bearer ${token}` }, data: { idempotencyKey: `g-${cap}-${Math.random().toString(36).slice(2)}`, ...(data as object) } });
      const j = (await r.json().catch(() => ({}))) as { data?: unknown };
      if (expect && r.status() !== expect) throw new Error(`${cap}: ${r.status()} ${JSON.stringify(j).replaceAll(REAL_KEY, "***").slice(0, 300)}`);
      return j.data;
    };
    await api("providers.add", { providerKey: "opencode-go", connection: "api_key", apiKey: REAL_KEY, scope: "mine" });
    const assistant = (await api("agents.list")).agents[0] as { agentId: string }; agentId = assistant.agentId;
    await api("agents.update", { agentId: assistant.agentId, patch: { model: GATE_MODEL } });
    await page.reload({ waitUntil: "load" }); await page.getByTestId("shell").waitFor({ timeout: 30_000 });
    const field = page.getByTestId("composer-field").first();
    let thread = "";
    const threadsMsgs = async (): Promise<Msg[]> => { if (!thread) { const t = ((await api("threads.list", {})).threads ?? []) as Array<{ threadId: string }>; if (t[0]) thread = t[0].threadId; } return thread ? (((await api("chat.messages.list", { threadId: thread })).messages ?? []) as Msg[]) : []; };
    const stopVisible = (): Promise<boolean> => page.getByTestId("stop-button").first().isVisible().catch(() => false);
    const step = async (name: string, f: () => Promise<Partial<{ result: string; ms: number; shot: string; note: string }> | void>): Promise<void> => {
      const t0 = Date.now();
      if (ONLY.length > 0 && !ONLY.some((n) => name.startsWith(n)) && !name.startsWith("1 ") && !name.startsWith("Terminal pane: open")) return;
      try { const r = (await f()) ?? {}; rec.add({ section: "C", step: name, result: r.result ?? "ok", ...(r.ms !== undefined ? { ms: r.ms } : {}), ...(r.shot ? { shot: r.shot } : {}), ...(r.note ? { note: r.note } : {}) }); }
      catch (e) { const msg = (e as Error).message.split("\n")[0]!.slice(0, 300); failures.push(`${name}: ${msg}`); rec.add({ section: "C", step: name, result: `FAIL ${msg}`, ms: Date.now() - t0, shot: await shot(`fail-${failures.length}`), note: (await body()).slice(-300) }); }
    };

    /** Ask in plain words and watch until the turn is over: press to first sign, longest silent gap, tool noise, final reply. */
    const job = async (tag: string, text: string, o: { limitMs?: number; during?: (t: number) => Promise<void>; startedWhenIdle?: boolean } = {}): Promise<{ done: number; firstSign: number; maxGap: number; gapAt: number; reply: string; toolCalls: number; turns: number; noise: string[]; shots: string[]; waitingForPerson: boolean }> => {
      for (let i = 0; i < 600 && (await stopVisible()); i++) await page.waitForTimeout(250);
      const msgs0 = (await threadsMsgs()).length;
      const before = await body();
      await field.fill(text);
      const t0 = Date.now();
      await field.press("Enter");
      let waitingForPerson = false; let last = before; let lastChange = Date.now(); let maxGap = 0; let gapAt = 0; let firstSign = -1; let done = -1; const shotsTaken: string[] = []; let nextShot = 4000;
      const lim = o.limitMs ?? 240_000;
      while (Date.now() - t0 < lim) {
        const b = await body();
        const now = Date.now();
        if (b !== last) { const gap = now - lastChange; if (gap > maxGap && firstSign >= 0) { maxGap = gap; gapAt = lastChange - t0; } last = b; lastChange = now; if (firstSign < 0 && b.length > before.length + 5) firstSign = now - t0; }
        const sv = await stopVisible();
        if (o.during) await o.during(now - t0);
        if (now - t0 >= nextShot && shotsTaken.length < 6) { shotsTaken.push(await shot(`${tag}-s${shotsTaken.length}`)); nextShot += 7000; }
        const ms = await threadsMsgs();
        const agentReplies = ms.slice(msgs0).filter((m) => m.author.kind === "agent" && m.body.trim() !== "");
        if (ms.length > msgs0 + 1 && now - t0 > 1500) {
          const turns = ((await api("engine.turns.list", { threadId: thread }).catch(() => ({ turns: [] }))).turns ?? []) as Array<{ state: string }>;
          const live = turns.some((x) => x.state === "running" || x.state === "queued");
          const needs = turns.some((x) => x.state === "waiting");
          if (!live && (agentReplies.length > 0 || needs)) { done = now - t0; if (needs) waitingForPerson = true; break; }
        }
        await page.waitForTimeout(400);
      }
      const ms = (await threadsMsgs()).slice(msgs0);
      const agentMs = ms.filter((m) => m.author.kind === "agent");
      const reply = agentMs.map((m) => m.body).filter((x) => x.trim() !== "").join("\n");
      const toolBlocks = agentMs.flatMap((m) => m.blocks ?? []).filter((b) => /tool|command|terminal|step/i.test(b.type));
      const noise = [...new Set((await body()).match(NOISE) ?? [])];
      return { done, firstSign, maxGap, gapAt, reply, toolCalls: toolBlocks.length, turns: agentMs.length, noise, shots: shotsTaken, waitingForPerson };
    };
    const summarise = (r: Awaited<ReturnType<typeof job>>): string => `done ${r.done} ms; first sign ${r.firstSign} ms; longest silence ${r.maxGap} ms at ${r.gapAt} ms; ${r.toolCalls} tool blocks, ${r.turns} agent messages; noise on screen: ${r.noise.join(",") || "none"}; turn left waiting for the person: ${r.waitingForPerson}; reply: ${r.reply.slice(0, 220).replace(/\n/g, " / ")}`;

    await step("1 folder, a Node script printing 20 primes, run it", async () => {
      const r = await job("c01", "Make a folder called demo, write a small Node script in it that prints the first 20 primes, run it, and show me the output.");
      const s = await shot("c01-done");
      assert.ok(r.done >= 0, "finished within the limit");
      assert.ok(/71/.test(r.reply) && /\b2\b/.test(r.reply), "the reply shows the primes up to 71");
      return { ms: r.done, shot: s, note: summarise(r) };
    });
    await guard.check("after job 1");

    // the Terminal the way a person opens it: Space menu, Open Terminal
    await step("Terminal pane: open it after job 1", async () => {
      await page.getByTestId("space-tile").first().click();
      await page.getByTestId("menu-item-Open Terminal").click();
      await page.waitForTimeout(2500);
      const ids = await page.evaluate(() => [...document.querySelectorAll("[data-testid]")].map((e) => e.getAttribute("data-testid") ?? "").filter((x) => /term/i.test(x)).join(","));
      const s = await shot("c02-terminal-open");
      return { shot: s, note: `ids: ${ids}; text: ${(await body()).slice(0, 500)}` };
    });
    await step("2 web server on 8080 in the background, fetch its index", async () => {
      await page.getByTestId("tab-chats").click().catch(() => undefined);
      await page.goto(`${web.origin}/chats`, { waitUntil: "load" }); await page.getByTestId("shell").waitFor({ timeout: 30_000 });
      const first = page.getByText("Make a folder called demo", { exact: false }).first(); await first.click().catch(() => undefined); await page.waitForTimeout(1200);
      const r = await job("c03", "Start a web server on port 8080 in the background that serves that folder, then fetch its index and tell me what came back.", { limitMs: 240_000 });
      const s = await shot("c03-done");
      assert.ok(r.done >= 0, "finished within the limit");
      assert.ok(/primes|Directory listing|index|200|<html/i.test(r.reply), "the reply says what came back");
      return { ms: r.done, shot: s, note: summarise(r) };
    });
    await step("3 a command longer than a typical tool wait (sleep 45)", async () => {
      const r = await job("c04", "Run `sleep 45 && echo done` and tell me when it finishes.", { limitMs: 300_000 });
      const s = await shot("c04-done");
      assert.ok(r.done >= 0, "finished within the limit");
      assert.ok(/done/i.test(r.reply), "the reply reports it finished");
      return { ms: r.done, shot: s, note: summarise(r) };
    });
    await step("4 a failing command: ls /nope", async () => {
      const r = await job("c05", "Run `ls /nope` and tell me what happened. If it fails, create a folder called nope in my home folder instead and list it.", { limitMs: 240_000 });
      const s = await shot("c05-done");
      assert.ok(r.done >= 0, "finished within the limit");
      assert.ok(/No such file|does not exist|doesn.t exist|not exist/i.test(r.reply), "the reply reads the error");
      return { ms: r.done, shot: s, note: summarise(r) };
    });
    await step("5 a command that asks for input (read -p)", async () => {
      const r = await job("c06", "Run `read -p \"name? \" n; echo hi $n` in the terminal and tell me what it printed.", { limitMs: 240_000 });
      const s = await shot("c06-done");
      assert.ok(r.done >= 0, "finished within the limit (not stuck on the prompt)");
      return { ms: r.done, shot: s, note: summarise(r) };
    });
    await step("6 Stop while a long command runs, then the next ask works", async () => {
      let stoppedAt = -1; let stopClickMs = -1;
      const r = await job("c07", "Run `sleep 120 && echo finished-long` and tell me when it is done.", { limitMs: 60_000, during: async (t) => { if (stoppedAt < 0 && t > 9000 && (await stopVisible())) { stoppedAt = t; await shot("c07-before-stop"); const tS = Date.now(); await page.getByTestId("composer-send").first().click({ force: true, timeout: 5000 }).catch(async () => { await page.getByTestId("stop-button").first().click({ force: true, timeout: 5000 }); }); stopClickMs = Date.now() - tS; } } });
      await page.waitForTimeout(1500);
      const afterStop = await body();
      const s = await shot("c07-after-stop");
      const idle = !(await stopVisible());
      const cid = docker("ps", "-q", "--filter", `label=vyre.workspace=${agentId}`).trim().split("\n")[0] ?? "";
      const procsAfterStop = docker("exec", cid, "sh", "-c", "ps -eo pid,etime,args | grep -E 'sleep 120' | grep -v grep || echo none").trim().replace(/\n/g, " / ");
      const pane = docker("exec", cid, "sh", "-c", "for s in $(tmux list-sessions -F '#S'); do echo \"[$s]\"; tmux capture-pane -p -t $s | tail -4; done").trim().replace(/\n/g, " / ").slice(0, 400);
      const listed = ((await api("terminal.list", {}).catch(() => ({}))) as { terminals?: Array<{ terminalId: string; name: string }> }).terminals ?? [];
      const calls: string[] = []; for (const t of listed) { const g = await context.request.post(`${web.origin}/v1/terminal/get`, { headers: { authorization: `Bearer ${token}` }, data: { terminalId: t.terminalId } }); calls.push(`${t.name}:get ${g.status()}`); }
      const tNext = Date.now();
      const next = await job("c08", "Run `echo next-ok` and tell me what it printed.", { limitMs: 240_000 });
      void tNext;
      assert.ok(stoppedAt >= 0, "Stop was pressed while the command ran");
      assert.ok(idle, "the working state ended");
      assert.ok(next.done >= 0 && /next-ok/.test(next.reply), "the next ask works");
      return { ms: r.done, shot: `${s}`, note: `stop pressed at ${stoppedAt} ms (click took ${stopClickMs} ms); turn ended ${r.done} ms after the ask; words after Stop: ${(afterStop.match(/(Stopped|stopped|Interrupted|still running)[^|]*/g) ?? []).join(" / ") || "none"}; sleep 120 right after Stop: ${procsAfterStop}; tmux panes: ${pane}; terminal.get after Stop: ${calls.join(" ")}; next ask done ${next.done} ms` };
    });

    // 7 the person types in the Terminal pane while the agent's commands are there; reload keeps the session
    await step("7 the Terminal pane: the agent's commands, a person typing, reload", async () => {
      await page.goto(`${web.origin}/chats`, { waitUntil: "load" }); await page.getByTestId("shell").waitFor({ timeout: 30_000 });
      await page.getByTestId("space-tile").first().click(); await page.getByTestId("menu-item-Open Terminal").click();
      await page.locator('[data-testid^="row-terminal-trm_"]').first().waitFor({ timeout: 20_000 });
      const tOpen = Date.now();
      const calls: string[] = [];
      page.on("response", async (resp) => { const u = resp.url(); if (/\/v1\/terminal\//.test(u)) calls.push(`${u.split("/v1/")[1]} ${resp.status()} ${(await resp.text().catch(() => "")).slice(0, 220).replaceAll(REAL_KEY, "***")}`); });
      await page.locator('[data-testid^="row-terminal-trm_"]').first().click();
      await page.waitForTimeout(2500);
      const lockedAtFirst = await page.getByTestId("terminal-locked").isVisible().catch(() => false);
      if (lockedAtFirst) { await shot("c09a-terminal-locked-for-the-owner"); await page.getByTestId("terminal-back").click().catch(() => undefined); }
      await page.getByTestId("terminal-screen").first().waitFor({ timeout: 30_000 }).catch(async (e) => { await shot("c09-terminal-no-screen"); fs.writeFileSync(path.join(shots, "terminal-calls.txt"), calls.join("\n")); throw e; });
      const openMs = Date.now() - tOpen; await page.waitForTimeout(1500);
      const s1 = await shot("c09-terminal-pane");
      const screen1 = await page.getByTestId("terminal-screen").first().innerText().catch(() => "");
      const sawAgent = /echo next-ok|sleep|primes|nope|ls \/nope|http\.server|node/.test(screen1);
      const ids = await page.evaluate(() => [...document.querySelectorAll("[data-testid]")].map((e) => e.getAttribute("data-testid") ?? "").filter((x) => /term/i.test(x)).join(","));
      const input = page.getByTestId("terminal-input").first();
      await input.click({ force: true }).catch(() => undefined);
      await page.keyboard.type("echo typed-by-the-person-1", { delay: 20 }); await page.keyboard.press("Enter");
      let typed = false; const tType = Date.now(); let typedMs = -1;
      for (let i = 0; i < 40; i++) { const t = await page.getByTestId("terminal-screen").first().innerText().catch(() => ""); if (/typed-by-the-person-1\s*\n?[^\n]*typed-by-the-person-1|typed-by-the-person-1[\s\S]*typed-by-the-person-1/.test(t)) { typed = true; typedMs = Date.now() - tType; break; } await page.waitForTimeout(250); }
      const s2 = await shot("c10-terminal-typed");
      await page.reload({ waitUntil: "load" }); await page.getByTestId("shell").waitFor({ timeout: 30_000 });
      await page.waitForTimeout(2500);
      const s3 = await shot("c11-terminal-after-reload");
      const ps = docker("exec", docker("ps", "-q", "--filter", `label=vyre.workspace=${agentId}`).trim().split("\n")[0] ?? "", "tmux", "list-sessions");
      assert.ok(typed, "what the person typed shows in the pane (and runs)");
      return { ms: openMs, shot: `${s1}, ${s2}, ${s3}`, note: `pane opened ${openMs} ms; owner saw the server shell LOCKED first: ${lockedAtFirst}; agent's earlier commands visible: ${sawAgent}; typed echo shown after ${typedMs} ms; ids: ${ids.slice(0, 300)}; tmux sessions: ${ps.trim().replace(/\n/g, " / ").slice(0, 200)}` };
    });

    await step("9 Files: a file the agent wrote shows up, and the agent reads a file the person added", async () => {
      const ag = (await api("agents.get", { agentId })).agent as { folderId: string };
      const r1 = await job("c15", "Create a file called hello-from-agent.txt in your Vyre folder (~/Vyre) with the single line: written by the agent. Then tell me it is done.", { limitMs: 180_000 });
      await page.goto(`${web.origin}/files`, { waitUntil: "load" }); await page.getByTestId("shell").waitFor({ timeout: 30_000 }); await page.waitForTimeout(2500);
      const filesText = await body(); const s1 = await shot("c15-files");
      const nameList = async (): Promise<string[]> => { const r = (await api("files.list", { folderId: ag.folderId }).catch(() => ({}))) as Record<string, unknown>; const arr = (r["files"] ?? r["items"] ?? r["entries"] ?? []) as Array<{ name?: string; title?: string }>; return arr.map((f) => f.name ?? f.title ?? ""); };
      let listed: string[] = []; for (let i = 0; i < 30; i++) { listed = await nameList(); if (listed.includes("hello-from-agent.txt")) break; await page.waitForTimeout(1000); }
      const keysSeen = JSON.stringify(Object.keys((await api("files.list", { folderId: ag.folderId }).catch(() => ({}))) as object));
      // a file the person adds to the agent's folder, which the agent reads
      await api("files.create", { folderId: ag.folderId, name: "from-the-person.txt", content: { text: "the secret word is MANGO" } });
      await page.goto(`${web.origin}/chats`, { waitUntil: "load" }); await page.getByTestId("shell").waitFor({ timeout: 30_000 });
      await page.getByText("Make a folder called demo", { exact: false }).first().click().catch(() => undefined); await page.waitForTimeout(1200);
      const r2 = await job("c16", "I added a file called from-the-person.txt for you. Read it and tell me the secret word.", { limitMs: 180_000 });
      const s2 = await shot("c16-read");
      assert.ok(listed.includes("hello-from-agent.txt"), `the agent's file is listed in its Files folder (listed: ${listed.join(",") || "nothing"}; list keys ${keysSeen})`);
      assert.ok(/MANGO/i.test(r2.reply), "the agent read the person's file");
      return { ms: r1.done, shot: `${s1}, ${s2}`, note: `agent wrote it in ${r1.done} ms; the agent folder lists: ${listed.join(", ") || "nothing"}; read-back job ${r2.done} ms: ${r2.reply.slice(0, 100)}` };
    });

    // 8 the workspace asleep, then the first command; then the daemon restarts mid-command
    await step("8a the workspace stopped, then the first command", async () => {
      const cid = docker("ps", "-q", "--filter", `label=vyre.workspace=${agentId}`).trim().split("\n")[0] ?? "";
      assert.ok(cid, "a workspace container is running");
      docker("stop", "-t", "2", cid);
      await page.goto(`${web.origin}/chats`, { waitUntil: "load" }); await page.getByTestId("shell").waitFor({ timeout: 30_000 });
      await page.getByText("Make a folder called demo", { exact: false }).first().click().catch(() => undefined); await page.waitForTimeout(1200);
      const r = await job("c12", "Run `ls ~/demo` and tell me what is in it.", { limitMs: 180_000 });
      const s = await shot("c12-done");
      assert.ok(r.done >= 0 && /primes/.test(r.reply), "the agent woke its workspace and listed the folder");
      return { ms: r.done, shot: s, note: summarise(r) };
    });
    await step("8b daemon restarted mid-command: the next turn works, the tmux session is still there", async () => {
      const cid0 = docker("ps", "-q", "--filter", `label=vyre.workspace=${agentId}`).trim().split("\n")[0] ?? "";
      let killed = false; let tRestart = -1;
      const r = await job("c13", "Run `sleep 40 && echo after-restart-a` and tell me what it printed.", { limitMs: 200_000, during: async (t) => { if (!killed && t > 12_000) { killed = true; await d.stop("SIGKILL"); await shot("c13-daemon-down"); await d.start(); tRestart = t; } } });
      const sAfter = await shot("c13-after");
      await page.reload({ waitUntil: "load" }); await page.getByTestId("shell").waitFor({ timeout: 40_000 });
      await page.getByText("Make a folder called demo", { exact: false }).first().click().catch(() => undefined); await page.waitForTimeout(1500);
      const next = await job("c14", "Run `echo second-ok` and tell me what it printed.", { limitMs: 180_000 });
      const sess = docker("exec", docker("ps", "-q", "--filter", `label=vyre.workspace=${agentId}`).trim().split("\n")[0] ?? cid0, "tmux", "list-sessions");
      const same = docker("ps", "-q", "--filter", `label=vyre.workspace=${agentId}`).trim().split("\n")[0] === cid0;
      assert.ok(next.done >= 0 && /second-ok/.test(next.reply), "the next turn works after the restart");
      return { ms: next.done, shot: `${sAfter}`, note: `restarted at ${tRestart} ms; the interrupted turn: ${summarise(r)}; same container ${same}; tmux: ${sess.trim().replace(/\n/g, " / ").slice(0, 200)}; next turn ${next.done} ms: ${next.reply.slice(0, 100)}` };
    });
    fs.writeFileSync(path.join(shots, "containers.txt"), docker("ps", "-a", "--filter", `label=vyre.workspace=${agentId}`, "--format", "{{.ID}} {{.Names}} {{.Image}} {{.Status}}"));
    fs.writeFileSync(path.join(shots, "after1-body.txt"), await body());
    fs.writeFileSync(path.join(shots, "containers.txt"), docker("ps", "-a", "--filter", `label=vyre.workspace=${agentId}`, "--format", "{{.ID}} {{.Names}} {{.Image}} {{.Status}}"));
    fs.writeFileSync(path.join(shots, "failures.txt"), failures.join("\n"));
    assert.deepEqual(errors, []);
  } finally {
    await browser.close(); web.close(); await d.stop();
    fs.writeFileSync(path.join(shots, "daemon.log"), d.log().replaceAll(REAL_KEY, "***"));
    // only what this walk's agent made: its workspace container, network and volumes (labelled or named with its id); other lanes share this Docker
    if (agentId !== "") {
      for (const id of docker("ps", "-aq", "--filter", `label=vyre.workspace=${agentId}`).split("\n").filter(Boolean)) docker("rm", "-f", id);
      for (const id of docker("network", "ls", "-q", "--filter", `label=vyre.workspace=${agentId}`).split("\n").filter(Boolean)) docker("network", "rm", id);
      for (const v of docker("volume", "ls", "-q").split("\n").filter((x) => x.includes(agentId))) docker("volume", "rm", "-f", v);
    }
  }
  assert.deepEqual(failures, [], "every step of the walk passed");
});
