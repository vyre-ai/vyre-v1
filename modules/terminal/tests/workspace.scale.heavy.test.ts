// @heavy docker
// A hundred agent workspaces on one host (owner, 12 Nov: "It needs to work on more than 30 workspaces too pretty smoothly without doing anything extra"). Docker's default address pools hold about 30
// networks, so a network each would have refused the 31st; with the one shared network, traffic between containers off, they all fit. The test makes 100, wakes 40 at once and runs a command in each,
// then the other 60 in waves on a host with room for 60 awake (the longest-quiet sleep to make room), measures each wake's time to first output, the host's memory and this process's CPU and Docker
// calls while 40 sit idle awake (with the Files mirror at its old fixed pace and at its paced one), and ends with every workspace asleep and no workspace network but the shared one.
// Runs only with VYRE_HEAVY_DOCKER=1; VYRE_WORKSPACE_TEST_IMAGE names the image (built from images/agent-workspace). The numbers are printed for the owner.
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { buildWorkspaceManager, createWorkspaceTerminalHost, workspaceName } from "../workspace.ts";
import type { WorkspaceManager, WorkspaceOptions } from "../workspace.ts";
import { unixSocketHttp } from "../../../sandbox/src/docker.ts";
import type { DockerHttp } from "../../../sandbox/src/docker.ts";

const ON = process.env["VYRE_HEAVY_DOCKER"] === "1" && process.env["VYRE_WORKSPACE_TEST_IMAGE"] !== undefined;
const skip: string | false = ON ? false : "needs VYRE_HEAVY_DOCKER=1 and VYRE_WORKSPACE_TEST_IMAGE (100 real containers)";
const IMAGE = process.env["VYRE_WORKSPACE_TEST_IMAGE"] ?? "";
const RUN = Math.random().toString(36).slice(2, 7);
const OWNER = `spc_scale${RUN}`;
const N = 100, FIRST = 40, ROOM = 60, IDLE_MS = Number(process.env["VYRE_SCALE_IDLE_MS"] ?? 60_000);
const ids = Array.from({ length: N }, (_, i) => `agt_scale${RUN}_${String(i).padStart(3, "0")}`);

const docker = (args: string[], ms = 120_000): Promise<string> => new Promise((r) => { execFile("docker", args, { timeout: ms, maxBuffer: 64 * 1024 * 1024 }, (_e, out) => r(String(out))); });
const pct = (xs: number[], p: number): number => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] ?? 0; };
const memUsedMb = (): number => { const m = readFileSync("/proc/meminfo", "utf8"); const v = (k: string): number => Number(new RegExp(`^${k}:\\s+(\\d+)`, "m").exec(m)?.[1] ?? 0) / 1024; return Math.round(v("MemTotal") - v("MemAvailable")); };
/** Networks of one workspace that belong to this test's workspaces (the box is shared: other lanes' workspaces may have their own). */
const workspaceNets = async (): Promise<string[]> => (await docker(["network", "ls", "--format", "{{.Name}} {{index .Labels \"vyre.workspace\"}}", "--filter", "label=vyre.workspace"])).split("\n").filter((l) => ids.includes(l.split(" ")[1] ?? ""));
/** The networks this test's workspaces are on. */
const netsOfMine = async (): Promise<string[]> => [...new Set((await Promise.all(ids.map((id) => docker(["inspect", "-f", "{{.HostConfig.NetworkMode}}", workspaceName(id)])))).map((x) => x.trim()).filter(Boolean))];

test("100 workspaces on one host: all made, 40 woken at once and the rest in waves, every command answers, idle costs little, and only the one shared network remains", { skip, timeout: 3_600_000 }, async (t) => {
  let calls = 0;
  const base = unixSocketHttp();
  const http: DockerHttp = (req) => { calls++; return base(req); };
  // the host's room: 60 awake at once (a real server's capacity says how many; this stands in for it)
  const awake = new Set<string>();
  const capacity: NonNullable<WorkspaceOptions["capacity"]> = {
    async claim(id) { if (awake.has(id) || awake.size < ROOM) { awake.add(id); return { state: "running" }; } return { state: "waiting", line: "Waiting for room on the Space server." }; },
    async release(id) { awake.delete(id); },
  };
  // the Files mirror's cost, as it is: each pass reads ~/Vyre through Docker's archive call
  const home = (): NonNullable<WorkspaceOptions["home"]> => ({
    sync: (x) => ({ async pass() { await x.fs.snapshot(); return { failed: 0 }; } }),
    readTar: () => ({ files: new Map(), dirs: new Set(), refused: [], complete: true }),
    manifest: (id) => `/tmp/${id}.json`,
  });
  const managers: WorkspaceManager[] = [];
  // the managers' clock, which the test moves on to make workspaces quiet for longer than making room waits (90 s) without waiting that long
  let skew = 0;
  const make = (o: Partial<WorkspaceOptions> = {}): WorkspaceManager => { const m = buildWorkspaceManager({ http, image: IMAGE, idleMs: 3_600_000, owner: OWNER, capacity, home: home(), now: () => Date.now() + skew, ...o }); managers.push(m); return m; };
  t.after(async () => {
    for (const m of managers) m.close();
    for (let i = 0; i < N; i += 20) await Promise.all(ids.slice(i, i + 20).map(async (id) => { await docker(["rm", "-f", workspaceName(id)]); await docker(["volume", "rm", "-f", `${workspaceName(id)}-home`, `${workspaceName(id)}-files`]); }));
  });
  const netsBefore = await docker(["network", "ls", "-q"]);
  const numbers: Record<string, unknown> = { workspaces: N };

  // ---- 100 made, stopped (each would have needed a network of its own before)
  let m = make({ mirrorMaxMs: 3000 });   // first the mirror at its old fixed pace, to measure "before"
  const t0 = Date.now();
  for (let i = 0; i < N; i += 10) await Promise.all(ids.slice(i, i + 10).map((id) => m.provision(id)));
  numbers["make 100 (s)"] = Math.round((Date.now() - t0) / 100) / 10;
  const listed = (await m.list()).filter((w) => ids.includes(w.agentId));
  assert.equal(listed.length, N, "all 100 exist");
  assert.deepEqual(await workspaceNets(), [], "no network of one workspace");
  assert.deepEqual(await netsOfMine(), ["vyre-workspaces"], "all 100 on the one shared network");
  numbers["networks the 100 workspaces are on"] = (await netsOfMine()).length;
  numbers["networks made on the host for them"] = (await docker(["network", "ls", "-q"])).split("\n").filter(Boolean).length - netsBefore.split("\n").filter(Boolean).length;

  // ---- 40 woken at once, one command each, all at the same time
  const run = async (mgr: WorkspaceManager, id: string): Promise<number> => {
    const h = createWorkspaceTerminalHost({ manager: mgr });
    const s0 = Date.now();
    await h.open({ terminalId: `trm_${id}`, target: { host: "agent_computer", agentId: id }, name: "agent", cols: 100, rows: 30, folders: [] });
    const r = await h.run(`trm_${id}`, { command: `echo hello-${id}`, env: {}, timeoutMs: 120_000 });
    assert.equal(r.output, `hello-${id}`, id);
    return Date.now() - s0;
  };
  const firstWave = await Promise.all(ids.slice(0, FIRST).map((id) => run(m, id)));
  numbers["wake 40 at once, time to first output p50 (ms)"] = pct(firstWave, 50);
  numbers["wake 40 at once, time to first output p95 (ms)"] = pct(firstWave, 95);

  // ---- 40 idle awake: what it costs, with the mirror at its old fixed pace (before) ...
  const idle = async (): Promise<{ cpuMsPerMin: number; dockerCallsPerMin: number; memMb: number }> => {
    const c0 = process.cpuUsage(), k0 = calls;
    await new Promise((r) => setTimeout(r, IDLE_MS));
    const c = process.cpuUsage(c0);
    return { cpuMsPerMin: Math.round(((c.user + c.system) / 1000) * (60_000 / IDLE_MS)), dockerCallsPerMin: Math.round((calls - k0) * (60_000 / IDLE_MS)), memMb: memUsedMb() };
  };
  numbers["40 idle awake, mirror every 3 s (before)"] = await idle();
  for (const id of ids.slice(0, FIRST)) await m.sleep(id);
  m.close();

  // ... and paced (after): the same 40 woken by a new process with the paced mirror
  m = make();
  await Promise.all(ids.slice(0, FIRST).map((id) => run(m, id)));
  await new Promise((r) => setTimeout(r, 70_000));   // past the minute after the last command, when pacing starts
  numbers["40 idle awake, paced mirror (after)"] = await idle();

  // ---- the other 60 in waves of 20: the host has room for 60 awake, so later waves put the longest-quiet to sleep to start at once. The first 40 stay mid-task the whole time (a command
  // every wave, as an agent between two commands of one task): none of them is ever put to sleep for room (lead, 12 Nov)
  const startedAt = async (id: string): Promise<string> => (await docker(["inspect", "-f", "{{.State.StartedAt}}", workspaceName(id)])).trim();
  const midTask = ids.slice(0, FIRST);
  const before = await Promise.all(midTask.map(startedAt));
  const waves: number[] = [];
  for (let i = FIRST; i < N; i += 20) {
    skew += 120_000;   // everyone not touched below is now quiet for longer than 90 s
    await Promise.all(midTask.map((id) => m.exec(id, ["true"])));
    waves.push(...(await Promise.all(ids.slice(i, i + 20).map((id) => run(m, id)))));
  }
  const after = await Promise.all(midTask.map(startedAt));
  assert.deepEqual(after, before, "none of the 40 mid-task workspaces was put to sleep (each was started once, before the waves)");
  numbers["mid-task workspaces slept for room"] = after.filter((x, i) => x !== before[i]).length;
  numbers["waves of 20 past the room, time to first output p50 (ms)"] = pct(waves, 50);
  numbers["waves of 20 past the room, time to first output p95 (ms)"] = pct(waves, 95);
  numbers["awake at the end of the waves"] = awake.size;
  assert.ok(awake.size <= ROOM, "never more awake than the room");

  // ---- isolation at this scale: two of them cannot reach each other; no IPv6 address to reach a neighbour by
  const [a, b] = [ids[N - 1]!, ids[N - 2]!];
  await m.exec(b, ["sh", "-c", "nohup python3 -m http.server 8099 >/dev/null 2>&1 &"]);
  await new Promise((r) => setTimeout(r, 1500));
  const ipB = (await docker(["inspect", "-f", "{{(index .NetworkSettings.Networks \"vyre-workspaces\").IPAddress}}", workspaceName(b)])).trim();
  assert.notEqual((await m.exec(a, ["sh", "-c", `curl -s -o /dev/null -m 4 http://${ipB}:8099/; echo $?`])).stdout.trim(), "0", "a workspace cannot reach another's port");
  assert.equal((await m.exec(a, ["sh", "-c", "grep -c eth0 /proc/net/if_inet6 || true"])).stdout.trim(), "0", "no IPv6 address on the shared network to reach a neighbour by");

  // ---- all asleep: no workspace network but the shared one
  const live = (await m.list()).filter((w) => ids.includes(w.agentId) && w.state === "running").map((w) => w.agentId);
  for (let i = 0; i < live.length; i += 20) await Promise.all(live.slice(i, i + 20).map((id) => m.sleep(id)));
  assert.equal((await m.list()).filter((w) => ids.includes(w.agentId) && w.state === "running").length, 0, "all asleep");
  assert.deepEqual(await workspaceNets(), [], "no network of one workspace left");
  numbers["networks of these workspaces with all asleep"] = (await workspaceNets()).length + 1;
  assert.deepEqual(await netsOfMine(), ["vyre-workspaces"]);
  numbers["host memory used with all asleep (MB)"] = memUsedMb();
  t.diagnostic(JSON.stringify(numbers, null, 1));
  console.log(`SCALE-NUMBERS ${JSON.stringify(numbers)}`);
});
