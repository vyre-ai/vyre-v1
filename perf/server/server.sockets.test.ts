// (the connection_count probe and the two todo probes; one of three files split from server.test.ts) P-L11_03: server and headless probes on a booted daemon over the perf Space, through the gateway with a real token (rule 27).
//   perf Space      the template loads in under 1 s
//   server_write    records.create at 200 ops/s: p50 and p95 under 10 ms (cap.commit; measured here as the whole round trip on loopback, an upper bound)
//   connection_count  a device holds exactly one live socket: a second connection replaces the first
//   engine_pool, send  need the agent turn engine on the daemon: todo until P-L2_23 (the module level proofs are agent/tests/pool.perf.test.ts and turn-engine.perf.test.ts)
// Ruling 46: a speed number counts only from the v1-perf runners. VYRE_PERF_FULL=1 builds the full Space (100k contacts) and holds the numbers to the budgets; without it the file runs at the
// ci scale, prints the same METRIC lines and asserts the structure (the pacer kept up, every create answered) with a loose ceiling that only catches a pathology.
import test from "node:test";
import assert from "node:assert/strict";
import { bootPerf, PERF_LIVE } from "../../fixtures/seed/perf/build.ts";
import { startSeeded } from "../../fixtures/seed/small/build.ts";
import { SCALE, cache, scratch, signedIn, sleep } from "./support.ts";

test("connection_count: a device holds one live socket, a second connection replaces the first", async () => {
  const space = await bootPerf({ scale: SCALE, cache, scratch: scratch() });
  const d = await startSeeded(space.dir, PERF_LIVE);
  try {
    const token = signedIn(d, "usr_noah", "dev_perfone");
    // the socket's address carries a one-use ticket, never the session token (POST /sync/v1/ticket, client/src/gateway/live-ticket.ts)
    const ticket = async (): Promise<string> => ((await (await fetch(`${d.url}/sync/v1/ticket`, { method: "POST", headers: { authorization: `Bearer ${token}` } })).json()) as { data: { ticket: string } }).data.ticket;
    const open = async (): Promise<{ ws: WebSocket; closed: Promise<number> }> => new Promise(async (resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${d.port}/sync/v1/ws?ticket=${await ticket()}`);
      const closed = new Promise<number>((r) => ws.addEventListener("close", (e) => r(e.code)));
      ws.addEventListener("open", () => resolve({ ws, closed }));
      ws.addEventListener("error", () => reject(new Error("could not connect")));
    });
    const a = await open();
    const b = await open();
    assert.equal(await Promise.race([a.closed, sleep(2000).then(() => -1)]), 4000, "the first socket is closed with 'replaced by a newer connection from this device'");
    const states = [a.ws.readyState, b.ws.readyState];
    const live = states.filter((s) => s === WebSocket.OPEN).length;
    console.log(`METRIC ${JSON.stringify({ name: "connection_count", value: live, budget: 1, pass: live === 1 })}`);
    assert.equal(live, 1, `open sockets for one device: ${live} (${states.join(",")})`);
    b.ws.close();
  } finally { await d.stop(); space.close(); }
});

test("engine_pool: engine.acquire on the daemon's pool is under 20 ms at p95", { todo: "P-L2_23 (L2): the daemon never constructs the agent turn engine, so there is no pool to acquire from; the module level proof is agent/tests/pool.perf.test.ts" }, () => {
  assert.fail("no engine pool on the booted daemon");
});

test("send: first token is the provider's latency plus under 150 ms of ours, over a booted daemon with 200 ms fake provider latency", { todo: "P-L2_23 and P-L2_LIVE (L2): no turn engine on the daemon and the chat module has no handlers; the module level proof is agent/tests/turn-engine.perf.test.ts" }, () => {
  assert.fail("no chat turn can run on the booted daemon");
});
