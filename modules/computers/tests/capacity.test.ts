// Capacity (6 Nov design): a host says what it can hold, a workload asks for room before it starts, and a full host queues the ask with a plain line instead of overcommitting.
// Real SQLite behind the host's ctx.db guard and the fake machine. The machine's own report (machines.list) and the container runtime's (capacity) are scripted per test.
import test from "node:test";
import assert from "node:assert/strict";
import { bindStarter, checkRoom, claimRoom, drainWaiting, fitsOf, heldOn, hostConfigLimits, HEADROOM_MB, isWaiting, LIMITS, releaseRoom, verdictOf, waitingLine } from "../capacity.ts";
import { get, provision, remove, sleep, sleepIdle, takeOver, wake } from "../handlers/lifecycle.ts";
import { prepare } from "../handlers/tools/common.ts";
import { codeOf, harness, MIN } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const MB = 1024 * 1024;
const LINE = "Waiting for room on the Space server. Add a compute server in Console > Computers to run more.";

/** The Space server as the machines module reports it. */
function report(h: Harness, o: { memMb?: number; usedMb?: number; diskFreeMb?: number; max?: number; cores?: number } = {}): void {
  h.respond["machines.list"] = () => ({
    machines: [{
      machineId: "space", name: "Space", cores: o.cores ?? 4, memBytes: (o.memMb ?? 16384) * MB,
      ...(o.max !== undefined ? { limits: { maxAgentComputers: o.max } } : {}),
      load: { memUsedBytes: (o.usedMb ?? 1024) * MB, diskFreeBytes: (o.diskFreeMb ?? 50_000) * MB },
    }],
  });
}
async function made(h: Harness, agent: string): Promise<string> {
  h.respond["agents.get"] = (i) => ({ agent: { agentId: i["agentId"], folderId: "fld_x", ownerId: "usr_dana" } });
  return (await provision(h.ctx, { agentId: agent, idempotencyKey: `k-${agent}` })).computer.computerId;
}

test("verdictOf: memory, count and disk each refuse with their own reason, and a host that reports nothing takes the workload", () => {
  const f = { name: "the Space server", totalMb: 8192, freeMb: 6000, cpus: 4, diskFreeMb: 50_000, maxAgentComputers: 2 };
  assert.deepEqual(verdictOf(f, { reserveMb: 0, counted: 0 }, "desktop"), { ok: true });
  const mem = verdictOf(f, { reserveMb: 4096, counted: 1 }, "desktop");
  assert.equal(mem.ok, false);
  assert.equal(!mem.ok && mem.reason, "memory", "4 GB held + 4 GB wanted is over 8 GB minus the headroom");
  const count = verdictOf({ ...f, totalMb: 65536, freeMb: 60000 }, { reserveMb: 8192, counted: 2 }, "desktop");
  assert.equal(!count.ok && count.reason, "count");
  const disk = verdictOf({ ...f, diskFreeMb: 500 }, { reserveMb: 0, counted: 0 }, "workspace");
  assert.equal(!disk.ok && disk.reason, "disk");
  const short = verdictOf({ ...f, freeMb: 100 }, { reserveMb: 0, counted: 0 }, "desktop");
  assert.equal(!short.ok && short.reason, "memory", "real free memory must cover the new one even when the books say there is room");
  assert.deepEqual(verdictOf({ name: "x" }, { reserveMb: 99999, counted: 99 }, "desktop"), { ok: true });
});

test("a workspace is small and not counted: the count limit stops desktops and browsers, memory alone bounds workspaces", () => {
  const f = { name: "s", totalMb: 8192, freeMb: 7000, maxAgentComputers: 1 };
  assert.deepEqual(verdictOf(f, { reserveMb: 0, counted: 1 }, "workspace"), { ok: true });
  assert.equal(verdictOf(f, { reserveMb: 0, counted: 1 }, "browser").ok, false);
  const budget = 8192 - HEADROOM_MB;
  assert.equal(fitsOf(f, { reserveMb: 0, counted: 0 }, "workspace"), Math.floor(budget / LIMITS.workspace.reserveMb), "a 8 GB host holds 26 workspaces beside nothing else");
  assert.equal(fitsOf(f, { reserveMb: 0, counted: 0 }, "desktop"), 1, "the count (1) is tighter than memory (1 by 4 GB)");
});

test("new containers: the workspace is 1 CPU and 1 GB with a soft 256 MB, desktops keep 2 CPUs and 4 GB, none has swap", () => {
  const w = hostConfigLimits("workspace");
  assert.deepEqual(w, { NanoCpus: 1e9, Memory: 1024 * MB, MemorySwap: 1024 * MB, PidsLimit: 512, MemoryReservation: 256 * MB, CpuShares: 256 });
  const d = hostConfigLimits("desktop");
  assert.deepEqual(d, { NanoCpus: 2e9, Memory: 4096 * MB, MemorySwap: 4096 * MB, PidsLimit: 1024 });
});

test("waking a desktop on a full host queues it with the plain line, and it starts by itself when another goes to sleep", async () => {
  const h = harness();
  report(h, { max: 1 });
  const a = await made(h, "agt_a"), b = await made(h, "agt_b");
  assert.equal((await wake(h.ctx, { computerId: a })).computer.state, "working");
  const q = (await wake(h.ctx, { computerId: b })).computer;
  assert.equal(q.state, "waking");
  assert.equal(q.caption, LINE);
  assert.equal(h.fake.named("start").filter((c) => (c.args as { computerId: string }).computerId === b).length, 0, "the container was never started");
  assert.equal(isWaiting(h.db, b), true);
  // asking again is the same ask: one waiting row
  await wake(h.ctx, { computerId: b });
  assert.equal(h.rows("SELECT * FROM computers_claim WHERE state = 'waiting'").length, 1);
  await sleep(h.ctx, { computerId: a });
  const after = (await get(h.ctx, { computerId: b })).computer;
  assert.equal(after.state, "working");
  assert.equal(after.caption, undefined, "the waiting line is gone once it runs");
  assert.equal(h.rows("SELECT * FROM computers_claim").length, 0);
});

test("a tool call on a computer that waits for room says why in the same words, and a takeover does not go on", async () => {
  const h = harness();
  report(h, { max: 1 });
  const a = await made(h, "agt_a"), b = await made(h, "agt_b");
  await wake(h.ctx, { computerId: a });
  await assert.rejects(() => prepare(h.ctx, b, { noWake: false, duringTakeover: false }), (e) => codeOf(e) === "provider.unavailable" && String((e as { message?: string }).message ?? "").includes(LINE));
  await assert.rejects(() => takeOver(h.ctx, { computerId: b }), (e) => codeOf(e) === "validation.precondition_failed");
  assert.equal(h.fake.named("takeover").length, 0);
});

test("memory: two desktops on an 8 GB host do not both start, one does; the reserve is what the host cannot give twice", async () => {
  const h = harness();
  report(h, { memMb: 8192, usedMb: 600 });
  const a = await made(h, "agt_a"), b = await made(h, "agt_b");
  assert.equal((await wake(h.ctx, { computerId: a })).computer.state, "working");
  const second = (await wake(h.ctx, { computerId: b })).computer;
  assert.equal(second.state, "waking");
  assert.equal(second.caption, LINE);
  assert.equal(heldOn(h.db, "space").reserveMb, 4096);
});

test("the container runtime's own figures count for the Space server, and a runtime that fails leaves the machine's report standing", async () => {
  const h = harness();
  report(h, { memMb: 16384, usedMb: 500 });
  h.fake.host.capacity = async () => ({ totalMb: 16384, freeMb: 200, cpus: 4, os: "linux" });
  const r = await checkRoom(h.ctx, { kind: "desktop" });
  assert.equal(r.verdict.ok, false, "200 MB really free refuses a desktop that holds back 4 GB");
  assert.equal(r.line, LINE);
  h.fake.host.capacity = async () => { throw new Error("no runtime"); };
  assert.equal((await checkRoom(h.ctx, { kind: "desktop" })).verdict.ok, true);
});

test("maxAgentComputers is enforced for desktops and Space browser profiles together", async () => {
  const h = harness();
  report(h, { max: 2 });
  const a = await made(h, "agt_a");
  await wake(h.ctx, { computerId: a });
  assert.deepEqual(await claimRoom(h.ctx, { kind: "browser", key: "brw_1" }), { state: "running" });
  const third = await claimRoom(h.ctx, { kind: "browser", key: "brw_2" });
  assert.equal(third.state, "waiting");
  assert.equal(third.line, LINE);
  // workspaces are not counted: they still start
  assert.deepEqual(await claimRoom(h.ctx, { kind: "workspace", key: "wks_1" }), { state: "running" });
  assert.deepEqual(await claimRoom(h.ctx, { kind: "workspace", key: "wks_2" }), { state: "running" });
});

test("claimRoom is idempotent, releaseRoom frees the place, and drainWaiting starts the oldest waiting workload with the starter of its kind", async () => {
  const h = harness();
  report(h, { max: 1 });
  const started: string[] = [];
  bindStarter("browser", async (_c, key) => { started.push(key); });
  try {
    assert.equal((await claimRoom(h.ctx, { kind: "browser", key: "brw_1" })).state, "running");
    assert.equal((await claimRoom(h.ctx, { kind: "browser", key: "brw_1" })).state, "running", "the same ask twice holds one place");
    h.advance(MIN);
    assert.equal((await claimRoom(h.ctx, { kind: "browser", key: "brw_2" })).state, "waiting");
    h.advance(MIN);
    assert.equal((await claimRoom(h.ctx, { kind: "browser", key: "brw_3" })).state, "waiting");
    assert.deepEqual(await drainWaiting(h.ctx), [], "nothing fits yet");
    releaseRoom(h.ctx, "brw_1");
    assert.deepEqual(await drainWaiting(h.ctx), ["brw_2"], "one place opened, the older one takes it");
    assert.deepEqual(started, ["brw_2"]);
    assert.equal(h.rows("SELECT state FROM computers_claim WHERE claim_key = 'brw_2'")[0]?.["state"], "running");
    assert.equal(h.rows("SELECT state FROM computers_claim WHERE claim_key = 'brw_3'")[0]?.["state"], "waiting");
  } finally { bindStarter("browser", null); }
});

test("a waiting kind with no starter bound is left alone, and a starter that throws gives up its place instead of looping", async () => {
  const h = harness();
  report(h, { max: 1 });
  await claimRoom(h.ctx, { kind: "browser", key: "brw_1" });
  await claimRoom(h.ctx, { kind: "browser", key: "brw_2" });
  releaseRoom(h.ctx, "brw_1");
  assert.deepEqual(await drainWaiting(h.ctx), [], "no starter, nothing to run");
  bindStarter("browser", async () => { throw new Error("did not start"); });
  try {
    assert.deepEqual(await drainWaiting(h.ctx), []);
    assert.equal(h.rows("SELECT * FROM computers_claim").length, 0);
  } finally { bindStarter("browser", null); }
});

test("putting a waiting computer to sleep cancels the wait, and removing one frees its place", async () => {
  const h = harness();
  report(h, { max: 1 });
  const a = await made(h, "agt_a"), b = await made(h, "agt_b"), c = await made(h, "agt_c");
  await wake(h.ctx, { computerId: a });
  await wake(h.ctx, { computerId: b });
  await wake(h.ctx, { computerId: c });
  assert.equal(h.rows("SELECT * FROM computers_claim WHERE state = 'waiting'").length, 2);
  const s = (await sleep(h.ctx, { computerId: b })).computer;
  assert.equal(s.state, "asleep");
  assert.equal(s.caption, undefined);
  await remove(h.ctx, { computerId: c });
  assert.equal(h.rows("SELECT * FROM computers_claim").length, 0);
});

test("the idle job checks the waiting line, so a raised limit starts the queue without any sleep", async () => {
  const h = harness();
  report(h, { max: 1 });
  const a = await made(h, "agt_a"), b = await made(h, "agt_b");
  await wake(h.ctx, { computerId: a });
  await wake(h.ctx, { computerId: b });
  assert.equal((await get(h.ctx, { computerId: b })).computer.state, "waking");
  report(h, { max: 3 });
  await sleepIdle(h.ctx);
  assert.equal((await get(h.ctx, { computerId: b })).computer.state, "working");
});

test("a full disk refuses to make another computer, in words and with the way out", async () => {
  const h = harness();
  report(h, { diskFreeMb: 900 });
  h.respond["agents.get"] = (i) => ({ agent: { agentId: i["agentId"], folderId: "fld_x" } });
  await assert.rejects(() => provision(h.ctx, { agentId: "agt_a", idempotencyKey: "k" }), (e) => codeOf(e) === "provider.unavailable" && /900 MB of disk/.test(String((e as { message?: string }).message)) && /Console > Computers/.test(String((e as { message?: string }).message)));
  assert.equal(h.rows("SELECT * FROM computers_computers").length, 0);
});

test("with nothing reported the old behaviour stands: every wake starts", async () => {
  const h = harness();
  const a = await made(h, "agt_a"), b = await made(h, "agt_b");
  assert.equal((await wake(h.ctx, { computerId: a })).computer.state, "working");
  assert.equal((await wake(h.ctx, { computerId: b })).computer.state, "working");
  assert.equal(waitingLine("x"), "Waiting for room on x. Add a compute server in Console > Computers to run more.");
});

test("a Space server whose limit the caller cannot see gets the machines default: half the cores, at least one", async () => {
  const h = harness();
  h.respond["machines.list"] = () => ({ machines: [] });
  h.fake.host.capacity = async () => ({ totalMb: 65536, freeMb: 60000, cpus: 4, os: "linux" });
  const a = await made(h, "agt_a"), b = await made(h, "agt_b"), c = await made(h, "agt_c");
  assert.equal((await wake(h.ctx, { computerId: a })).computer.state, "working");
  assert.equal((await wake(h.ctx, { computerId: b })).computer.state, "working");
  assert.equal((await wake(h.ctx, { computerId: c })).computer.state, "waking", "4 cores: two at once");
  h.fake.host.capacity = async () => ({ totalMb: 65536, freeMb: 60000, cpus: 1, os: "linux" });
  assert.equal((await checkRoom(h.ctx, { kind: "browser" })).verdict.ok, false, "1 core still allows one, and two are already running");
});
