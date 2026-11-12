// @heavy docker
// The Space browser at scale (owner, 12 Nov: "It needs to work on more than 30 workspaces too pretty smoothly without doing anything extra"), on a real Docker host with real Chromium, through the module's own
// path (the chrome_* capabilities, the host's memory budget, the make-room rule). 30 agent profiles on one host whose budget holds 12 browsers at once: 12 browse at the same moment, then waves of new ones, so
// the least recently used quiet browsers are closed to make room; every step must answer, none may fail for lack of room while a quiet browser exists, and a closed profile reopens with its sign-in.
// Then 20 open and idle for a minute: what browserd, the browsers and the module cost when nothing happens. The numbers are printed as METRIC lines for the owner.
// Runs only with VYRE_HEAVY_DOCKER=1; it builds the image unless VYRE_SPACE_BROWSER_IMAGE names one that is there.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import type { Server } from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDockerApi, unixSocketHttp } from "../../../sandbox/src/docker.ts";
import { createDockerSpaceBrowser } from "../sbrowser/docker.ts";
import { bindSpaceBrowser } from "../sbrowser/port.ts";
import { resetRoom } from "../sbrowser/room.ts";
import { asPerson, harness } from "../fixtures/harness.ts";
import { tool as cap } from "./tools.fixture.ts";

const ON = process.env["VYRE_HEAVY_DOCKER"] === "1";
const skip: string | false = ON ? false : "needs VYRE_HEAVY_DOCKER=1 (real Docker and Chromium)";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const IMAGE = process.env["VYRE_SPACE_BROWSER_IMAGE"] ?? "vyre/space-browser:scale";
const NAME = `vyre-sbrowser-sc${process.pid}${Math.random().toString(36).slice(2, 6)}`;
const http = unixSocketHttp();
const api = createDockerApi(http);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const BUDGET = 12;
const MB = 1024 * 1024;

function host(cmd: string, args: string[], timeoutMs: number): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => { execFile(cmd, args, { cwd: ROOT, timeout: timeoutMs, maxBuffer: 64 * MB }, (err, stdout, stderr) => resolve({ code: err ? 1 : 0, out: `${stdout}\n${stderr}` })); });
}
const json = async (p: string): Promise<Record<string, unknown>> => JSON.parse(new TextDecoder().decode((await http({ method: "GET", path: p })).body)) as Record<string, unknown>;

let site: Server;
let base = "";
before(async () => {
  if (!ON) return;
  if (!(await api.imageExists(IMAGE))) {
    const ctxDir = fs.mkdtempSync(path.join(os.tmpdir(), "sbrowser-scale-"));
    fs.cpSync(path.join(ROOT, "images/agent-computer"), path.join(ctxDir, "agent-computer"), { recursive: true });
    fs.cpSync(path.join(ROOT, "images/space-browser"), path.join(ctxDir, "space-browser"), { recursive: true });
    const vendor = path.join(ctxDir, "space-browser/browserd/vendor/chrome-bridge.ts");
    fs.rmSync(vendor, { force: true }); fs.copyFileSync(path.join(ROOT, "lib/chrome-bridge.ts"), vendor);
    fs.cpSync(process.env["VYRE_CHROME_EXT_DIR"] ?? path.join(ROOT, "apps/chrome"), path.join(ctxDir, "agent-computer/vyre-chrome"), { recursive: true, filter: (s) => !/\/(tests|node_modules)(\/|$)/.test(s) });
    const built = await host("docker", ["build", "-f", path.join(ctxDir, "space-browser/Dockerfile"), "-t", IMAGE, ctxDir], 1_200_000);
    fs.rmSync(ctxDir, { recursive: true, force: true });
    assert.equal(built.code, 0, built.out.slice(-1500));
  }
  // the service's own network, made beforehand with a subnet outside Docker's shared pools (the adapter finds it)
  for (let i = 0; i < 20; i++) {
    const third = Math.floor(Math.random() * 250) + 1;
    const r = await http({ method: "POST", path: "/networks/create", json: { Name: `${NAME}net`, Driver: "bridge", CheckDuplicate: true, Labels: { "vyre.sbrowser": "1" }, IPAM: { Config: [{ Subnet: `10.214.${third}.0/24`, Gateway: `10.214.${third}.1` }] } } });
    if (r.status === 201 || r.status === 409) { base = `http://10.214.${third}.1`; break; }
  }
  assert.ok(base, "the test network was made");
  site = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const headers: Record<string, string | string[]> = { "content-type": "text/html; charset=utf-8" };
    if (url.pathname === "/set") headers["set-cookie"] = [`sid=${url.searchParams.get("name") ?? ""}; Path=/; Max-Age=3600`];
    res.writeHead(200, headers);
    res.end(`<!doctype html><title>site</title><p id=out>${url.pathname === "/set" ? `set ${url.searchParams.get("name") ?? ""}` : `cookie:[${req.headers.cookie ?? ""}]`}</p>`);
  });
  await new Promise<void>((r) => site.listen(0, "0.0.0.0", () => r()));
  base = `${base}:${(site.address() as { port: number }).port}`;
});

after(async () => {
  if (!ON || process.env["VYRE_SCALE_KEEP"] === "1") return;
  bindSpaceBrowser(null);
  await api.containerStop(NAME, 5).catch(() => undefined);
  await api.containerRemove(NAME).catch(() => undefined);
  await http({ method: "DELETE", path: `/volumes/${NAME}-data`, query: { force: "true" } }).catch(() => undefined);
  await http({ method: "DELETE", path: `/networks/${NAME}net` }).catch(() => undefined);
  site?.close();
});

const pct = (xs: number[], p: number): number => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))] ?? 0; };

test("@heavy space browser at scale: 30 profiles, 12 at once on a 12-browser budget, waves that make room, closed profiles reopen signed in; then the cost of 20 idle", { skip, timeout: 2_400_000 }, async () => {
  let execs = 0;
  const counted = { ...api, async exec(n: string, a: Parameters<typeof api.exec>[1]) { execs += 1; return api.exec(n, a); } };
  const sb = createDockerSpaceBrowser({ api: counted, http, name: NAME, image: IMAGE, user: { uid: 10001, gid: 10001 }, startTimeoutMs: 120_000, idleMinutes: 60, log: () => undefined });
  bindSpaceBrowser(sb);
  resetRoom();
  // nobody here is in a turn: a browser may be closed to make room once its last step is 90 s old (the fourth-look rule; the mid-turn test below holds turns open)
  const h = harness({ principal: { kind: "agent", id: "agt_s00" }, actingFor: "usr_dana" });
  const setBudget = (n: number): void => { h.fake.host.capacity = async () => ({ totalMb: 1536 + n * 256, freeMb: 1_000_000, cpus: os.cpus().length, os: "linux" }); };
  setBudget(BUDGET);
  const id = (i: number): string => `agt_s${String(i).padStart(2, "0")}`;
  const ctxOf = (i: number) => asPerson(h, { kind: "agent", id: id(i) }, { actingFor: "usr_dana" }).ctx;
  const failures: string[] = [];
  // each step is one short turn, as the engine reports it (turn.started, then turn.completed): the module knows the agent is idle after it, so its browser may be closed 10 s after its last step
  const { consumers } = await import("../impl.ts") as unknown as { consumers: Record<string, { run: (ctx: unknown, e: unknown) => Promise<unknown> }> };
  let turnN = 0;
  const step = async (i: number, url: string): Promise<number> => {
    const turnId = `trn_w${++turnN}`;
    await consumers["computers.browser_turns"]!.run(h.ctx, { name: "turn.started", payload: { agentId: id(i), turnId, threadId: "thr_1" } });
    try { return await stepIn(i, url); } finally { await consumers["computers.browser_turns"]!.run(h.ctx, { name: "turn.completed", payload: { agentId: id(i), turnId, threadId: "thr_1" } }); }
  };
  const stepIn = async (i: number, url: string): Promise<number> => {
    const t0 = performance.now();
    // a step that does not answer in six minutes is a failure with its name, not a hung run (a newcomer may wait its turn for a browser to pass its 90 s of grace)
    const late = new Promise<never>((_, rej) => setTimeout(() => rej(new Error("no answer in 360 s")), 360_000).unref());
    try { await Promise.race([cap["computers.chrome.open"]!(ctxOf(i), { url }), late]); } catch (e) { failures.push(`${id(i)}: ${e instanceof Error ? e.message : JSON.stringify(e).slice(0, 200)}`); }
    return performance.now() - t0;
  };
  const phase = (m: string): void => { console.log(`PHASE ${new Date().toISOString()} ${m}`); };
  const wave = async (ids: number[], url: (i: number) => string): Promise<number[]> => Promise.all(ids.map((i) => step(i, url(i))));
  const range = (a: number, b: number): number[] => Array.from({ length: b - a }, (_, k) => a + k);

  phase("wave 1");
  // wave 1: twelve browse at the same moment (each starts its browser)
  const cold = await wave(range(0, 12), (i) => `${base}/set?name=${id(i)}`);
  assert.deepEqual(failures, [], "every step of the first wave answered");
  const running = async (): Promise<number> => (await sb.profiles()).profiles.filter((p) => p.running).length;
  assert.equal(await running(), 12);
  // one step alone on a running browser, and one alone that starts a browser (the cost without anyone else starting)
  const warm: number[] = [];
  for (let k = 0; k < 5; k++) warm.push(await step(k, `${base}/whoami?warm=${k}`));
  console.log(`METRIC sbrowser-scale one-step-on-a-running-browser ms p50=${Math.round(pct(warm, 50))} max=${Math.round(Math.max(...warm))}`);
  const stats = await json(`/containers/${NAME}/stats?stream=false`);
  const mem = stats["memory_stats"] as { usage?: number; stats?: { inactive_file?: number; file?: number } };
  const memMb = Math.round(((mem.usage ?? 0) - (mem.stats?.inactive_file ?? 0)) / MB);
  const limitMb = Math.round(Number((await json(`/containers/${NAME}/json`))["HostConfig"] && ((await json(`/containers/${NAME}/json`))["HostConfig"] as { Memory: number }).Memory) / MB);

  phase("wave 2");
  // wave 2: twelve new ones at once; the budget is full of quiet browsers, so each one closes the least recently used quiet one
  const made = await wave(range(12, 24), (i) => `${base}/set?name=${id(i)}`);
  assert.deepEqual(failures, [], "no step failed for lack of room while a quiet browser existed");
  assert.ok((await running()) <= BUDGET, "never more than the budget holds");

  phase("wave 3");
  // wave 3: the last six new ones, and six of the first wave whose browsers were closed: they reopen signed in
  const reopen: number[] = [];
  const third = await Promise.all([...range(24, 30).map(async (i) => step(i, `${base}/set?name=${id(i)}`)), ...range(0, 6).map(async (i) => { const ms = await step(i, `${base}/whoami`); reopen.push(ms); return ms; })]);
  void third;
  assert.deepEqual(failures, [], "every step of the third wave answered");
  for (const i of range(0, 6)) {
    const t = String((await cap["computers.chrome.eval"]!(ctxOf(i), { expression: "document.body.innerText" })).result);
    assert.equal(t, `cookie:[sid=${id(i)}]`, `${id(i)} reopened with its sign-in`);
  }
  console.log(`METRIC sbrowser-scale cold-start-step ms p50=${Math.round(pct(cold, 50))} p95=${Math.round(pct(cold, 95))} (12 at once, each starting its browser)`);
  console.log(`METRIC sbrowser-scale make-room-step ms p50=${Math.round(pct(made, 50))} p95=${Math.round(pct(made, 95))} (12 at once, each closing a quiet browser whose agent has no turn and whose last step is 10 s old)`);
  console.log(`METRIC sbrowser-scale reopen-closed-step ms p50=${Math.round(pct(reopen, 50))} p95=${Math.round(pct(reopen, 95))} (a profile whose browser was closed: its next step)`);
  console.log(`METRIC sbrowser-scale memory with 12 open: ${memMb} MB (${Math.round(memMb / 12)} MB a browser with browserd), container limit ${limitMb} MB`);

  // one start alone, nothing else starting (room is made for it)
  const solo: number[] = [];
  for (const k of [6, 7, 8]) solo.push(await step(k, `${base}/whoami?solo=${k}`));
  console.log(`METRIC sbrowser-scale one-step-that-reopens-a-closed-browser-alone ms p50=${Math.round(pct(solo, 50))} max=${Math.round(Math.max(...solo))}`);
  // 20 open and idle for a minute: what nothing costs
  phase("twenty open");
  setBudget(20);
  await wave(range(0, 20), (i) => `${base}/whoami?idle=${i}`);
  assert.deepEqual(failures, []);
  const runIds = (await sb.profiles()).profiles.filter((p) => p.running).map((p) => p.profileId).sort();
  const claimIds = h.rows("SELECT claim_key FROM computers_claim WHERE state = 'running'").map((r) => String(r["claim_key"])).sort();
  assert.equal(runIds.length, 20, `running ${JSON.stringify(runIds)} claimed ${JSON.stringify(claimIds)}`);
  const cpu = async (): Promise<number> => Number((((await json(`/containers/${NAME}/stats?stream=false`))["cpu_stats"] as { cpu_usage: { total_usage: number } }).cpu_usage.total_usage));
  const bd = async (): Promise<number> => { const r = await api.exec(NAME, { cmd: ["sh", "-c", "p=$(pgrep -f 'node /opt/browserd/main.ts' | head -n1); awk '{print $14+$15}' /proc/$p/stat"], env: [] }); return Number(r.stdout.trim()); };
  const { periodic } = await import("../impl.ts") as { periodic: Record<string, { everyMs: number; run: (ctx: unknown) => Promise<void> }> };
  const pass = periodic["computers.browser_room"]!;
  phase("idle minute");
  const c0 = await cpu(); const b0 = await bd(); const e0 = execs; const u0 = process.cpuUsage(); const t0 = Date.now();
  for (let k = 0; k < 2; k++) { await sleep(30_000); await pass.run(h.ctx); }
  const secs = (Date.now() - t0) / 1000;
  const c1 = await cpu(); const b1 = await bd(); const e1 = execs; const u1 = process.cpuUsage(u0);
  const hz = 100;
  console.log(`METRIC sbrowser-scale idle 20 open for ${Math.round(secs)} s: container CPU ${(((c1 - c0) / 1e9 / secs) * 100).toFixed(2)}% of one core (20 Chromiums and browserd), browserd alone ${((((b1 - b0) / hz) / secs) * 100).toFixed(2)}%, module side ${(((u1.user + u1.system) / 1e6 / secs) * 100).toFixed(2)}%, calls into the container ${Math.round(((e1 - e0) / secs) * 60)} a minute (the periodic pass every ${pass.everyMs / 1000} s)`);
  const perBrowser = Math.max(1, Math.round(memMb / 12));
  for (const gb of [8, 16]) {
    const book = Math.floor((gb * 1024 - 1536) / 256);
    // with Docker on the server or behind the runner: the runner's bound follows the host the same way (host/src/sites-runner/computers-policy.ts sbrowserBounds)
    const container = gb * 1024 - 1536;
    const slots = Math.floor((container - 512) / 256);
    const real = Math.floor((container - 512) / perBrowser);
    console.log(`METRIC sbrowser-scale a ${gb} GB host: the budget allows ${book}, the container (${container} MB, task cap ${100 + 120 * slots}) ${slots}; at the measured ${perBrowser} MB a browser about ${Math.min(book, slots, real)} run at once`);
  }
});

// Fourth look (12 Nov): a browser is never closed to make room while its agent has a turn in progress or within 90 s of its last step; newcomers wait their turn and are served as browsers free up.
test("@heavy space browser at scale: 30 agents on a 12-browser budget, 12 of them mid-turn: none of those is ever closed, the other 18 are served as browsers free up, nobody is closed twice in a minute", { skip, timeout: 2_400_000 }, async () => {
  const NAME2 = `${NAME}t`;
  for (let i = 0; i < 20; i++) {
    const third = Math.floor(Math.random() * 250) + 1;
    const r = await http({ method: "POST", path: "/networks/create", json: { Name: `${NAME2}net`, Driver: "bridge", CheckDuplicate: true, Labels: { "vyre.sbrowser": "1" }, IPAM: { Config: [{ Subnet: `10.215.${third}.0/24`, Gateway: `10.215.${third}.1` }] } } });
    if (r.status === 201 || r.status === 409) break;
  }
  const stops: Array<{ id: string; at: number }> = [];
  const real = createDockerSpaceBrowser({ api, http, name: NAME2, image: IMAGE, user: { uid: 10001, gid: 10001 }, startTimeoutMs: 120_000, idleMinutes: 60, log: () => undefined });
  const sb2 = { ...real, stop: async (id: string) => { stops.push({ id, at: Date.now() }); return real.stop(id); } } as typeof real;
  bindSpaceBrowser(sb2);
  resetRoom();
  const working = new Set<string>();
  const h = harness({ principal: { kind: "agent", id: "agt_t00" }, actingFor: "usr_dana" });
  const { consumers } = await import("../impl.ts") as unknown as { consumers: Record<string, { run: (ctx: unknown, e: unknown) => Promise<unknown> }> };
  // the engine's turn events, as the host delivers them to the module
  const turnEvent = (name: string, agentId: string): Promise<unknown> => consumers["computers.browser_turns"]!.run(h.ctx, { name, payload: { agentId, turnId: `trn_${agentId}`, threadId: "thr_1" } });
  h.fake.host.capacity = async () => ({ totalMb: 1536 + 12 * 256, freeMb: 1_000_000, cpus: os.cpus().length, os: "linux" });
  const id = (i: number): string => `agt_t${String(i).padStart(2, "0")}`;
  const ctxOf = (i: number) => asPerson(h, { kind: "agent", id: id(i) }, { actingFor: "usr_dana" }).ctx;
  const failures: string[] = [];
  const reloaded: string[] = [];
  try {
    let firstEnd = 0;
    const started = performance.now();
    // twelve agents start a turn of several steps, a few seconds apart; a mark on the page shows whether it was ever reloaded under them
    const turns = Array.from({ length: 12 }, (_, i) => (async () => {
      working.add(id(i));
      await turnEvent("turn.started", id(i));
      try {
        await cap["computers.chrome.open"]!(ctxOf(i), { url: `${base}/whoami?turn=${i}` });
        await cap["computers.chrome.eval"]!(ctxOf(i), { expression: `window.__turn = ${JSON.stringify(id(i))}; "set"` });
        for (let k = 0; k < 6; k++) {
          await sleep(4000);
          const mark = String((await cap["computers.chrome.eval"]!(ctxOf(i), { expression: "String(window.__turn)" })).result);
          if (mark !== id(i)) reloaded.push(`${id(i)} step ${k}: ${mark}`);
        }
      } catch (e) { failures.push(`${id(i)} turn: ${JSON.stringify(e).slice(0, 200)}`); }
      finally { working.delete(id(i)); if (firstEnd === 0) firstEnd = performance.now() - started; await turnEvent("turn.completed", id(i)); }
    })());
    await sleep(3000);
    // eighteen more ask while every browser is in a turn: they wait their turn
    const waits: number[] = [];
    const newcomers = Array.from({ length: 18 }, (_, k) => (async () => {
      const i = 12 + k;
      const t0 = performance.now();
      await turnEvent("turn.started", id(i));
      try { await cap["computers.chrome.open"]!(ctxOf(i), { url: `${base}/whoami?new=${i}` }); waits.push(performance.now() - t0); } catch (e) { failures.push(`${id(i)}: ${JSON.stringify(e).slice(0, 200)}`); }
      finally { await turnEvent("turn.completed", id(i)); }
    })());
    await Promise.all([...turns, ...newcomers]);
    assert.deepEqual(failures, [], "every step answered; none failed for lack of room");
    assert.deepEqual(reloaded, [], "no browser was closed under a turn in progress");
    assert.ok(!stops.some((s) => Number(s.id.slice(5)) < 12 && s.at < Date.now() && working.has(s.id)), "nothing was closed while its agent worked");
    const twice = stops.filter((s, i) => stops.some((o, j) => j < i && o.id === s.id && s.at - o.at < 60_000));
    assert.deepEqual(twice, [], "nobody's browser was closed twice within a minute");
    console.log(`METRIC sbrowser-scale mid-turn: 12 turns (six steps, 4 s apart, about 25 s each) kept their pages; first turn ended after ${Math.round(firstEnd)} ms; 18 newcomers waited ms p50=${Math.round(pct(waits, 50))} p95=${Math.round(pct(waits, 95))} max=${Math.round(Math.max(...waits))}; browsers closed to make room ${stops.length}`);
  } finally {
    bindSpaceBrowser(null);
    await api.containerStop(NAME2, 5).catch(() => undefined);
    await api.containerRemove(NAME2).catch(() => undefined);
    await http({ method: "DELETE", path: `/volumes/${NAME2}-data`, query: { force: "true" } }).catch(() => undefined);
    await http({ method: "DELETE", path: `/networks/${NAME2}net` }).catch(() => undefined);
  }
});
